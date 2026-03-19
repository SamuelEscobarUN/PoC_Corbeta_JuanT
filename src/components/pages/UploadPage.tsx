/**
 * UploadPage — tabs for file upload and data preview/transformation.
 */
import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Button,
  TextField,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FileUploadForm from '../organisms/FileUploadForm';
import UploadHistory from '../organisms/UploadHistory';
import type { UploadRecord } from '../../types/upload';
import type { CascadeStage } from '../../types/csv';
import { uploadService } from '../../services/upload';
import { parseCSV, parseMonetaryValue } from '../../services/csv-validator';
import { STAGE_DISPLAY_NAMES } from '../organisms/FileUploadForm';

export default function UploadPage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [tabIndex, setTabIndex] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<UploadRecord | null>(null);

  // Preview state
  const [rawData, setRawData] = useState<Record<string, string>[]>([]);
  const [transformedRows, setTransformedRows] = useState<Record<string, string>[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handlePreview = (record: UploadRecord) => {
    setSelectedRecord(record);
    setTabIndex(1);
  };

  useEffect(() => {
    if (!selectedRecord || tabIndex !== 1) return;
    loadPreview(selectedRecord);
  }, [selectedRecord, tabIndex]);

  async function loadPreview(record: UploadRecord) {
    setLoadingPreview(true);
    setPreviewError('');
    setRawData([]);
    setTransformedRows([]);
    try {
      const content = await uploadService.downloadFile(record.s3Key);
      const parsed = parseCSV(content);
      setRawData(parsed);

      // For integracion, load Geopos Local as reference to fix truncated invoices
      let geoposLocalRows: Record<string, string>[] | undefined;
      if (record.stage === 'integracion') {
        geoposLocalRows = await loadGeoposLocalReference();
      }

      // Apply transformation based on stage
      const transformed = applyTransformation(parsed, record.stage, record.uploadId, geoposLocalRows);
      setTransformedRows(transformed);
    } catch {
      setPreviewError('Error al descargar o procesar el archivo.');
    } finally {
      setLoadingPreview(false);
    }
  }

  /**
   * Load the most recent Geopos Local upload to use as reference
   * for fixing truncated invoices in Integración.
   */
  async function loadGeoposLocalReference(): Promise<Record<string, string>[] | undefined> {
    try {
      const result = await uploadService.getUploadHistory({ stage: 'geopos_local' }, null, 1);
      if (result.items.length === 0) return undefined;
      const content = await uploadService.downloadFile(result.items[0].s3Key);
      return parseCSV(content);
    } catch {
      return undefined;
    }
  }

  /**
   * Apply the appropriate transformation for the stage and return
   * flat rows for table display.
   */
  function applyTransformation(
    rows: Record<string, string>[],
    stage: CascadeStage,
    _uploadId: string,
    geoposLocalRows?: Record<string, string>[],
  ): Record<string, string>[] {
    if (stage === 'geopos_local' || stage === 'geopos_central') {
      // Build records from parsed rows directly
      const records = rows.map((r) => ({
        invoice: r['invoice'] ?? '',
        total: parseMonetaryValue(r['total'] ?? '0'),
      }));

      // UNIQUE invoices + XLOOKUP (first matching total)
      const seen = new Map<string, number>();
      for (const rec of records) {
        if (!seen.has(rec.invoice)) {
          seen.set(rec.invoice, rec.total);
        }
      }

      return Array.from(seen.entries()).map(([invoice, total]) => ({
        U_INVOICE: invoice,
        U_TOTAL: total.toLocaleString('es-CO'),
      }));
    }

    if (stage === 'integracion') {
      // Build suffix indexes for matching WITHOUT requiring total match,
      // because individual row totals won't match GL totals (SUMIF happens after).
      const geoposSuffixMaps = new Map<number, Map<string, string[]>>();
      const geoposInvoices: string[] = [];
      const SUFFIX_LENGTHS = [7, 8, 9, 10, 11, 12];

      if (geoposLocalRows) {
        for (const len of SUFFIX_LENGTHS) {
          geoposSuffixMaps.set(len, new Map());
        }
        for (const r of geoposLocalRows) {
          const inv = r['invoice'] ?? '';
          if (!inv) continue;
          geoposInvoices.push(inv);
          for (const len of SUFFIX_LENGTHS) {
            if (inv.length >= len) {
              const suffix = inv.slice(-len);
              const sMap = geoposSuffixMaps.get(len)!;
              const arr = sMap.get(suffix) ?? [];
              if (!arr.includes(inv)) arr.push(inv);
              sMap.set(suffix, arr);
            }
          }
        }
      }

      /** Resolve a truncated invoice to its full GL invoice (no total match needed). */
      function resolveInvoice(truncated: string): string {
        // 1. Suffix matching at multiple lengths (longest first)
        for (let len = Math.min(truncated.length, 12); len >= 7; len--) {
          const suffix = truncated.slice(-len);
          const candidates = geoposSuffixMaps.get(len)?.get(suffix);
          if (candidates && candidates.length === 1) return candidates[0];
        }
        // 2. GL invoice contains the truncated invoice as substring
        const containsMatches = geoposInvoices.filter((g) => g.includes(truncated));
        if (containsMatches.length === 1) return containsMatches[0];
        // 3. Fallback: first match at any suffix length
        for (let len = Math.min(truncated.length, 12); len >= 7; len--) {
          const suffix = truncated.slice(-len);
          const candidates = geoposSuffixMaps.get(len)?.get(suffix);
          if (candidates && candidates.length > 0) return candidates[0];
        }
        return truncated;
      }

      // Fix truncated invoices for return/return-void, then SUMIF
      const totalsMap = new Map<string, number>();
      for (const r of rows) {
        const tipoVenta = (r['tipo_venta'] ?? '').toLowerCase().trim();
        let invoice = r['invoice'] ?? '';
        const total = parseMonetaryValue(r['total'] ?? '0');

        if (tipoVenta === 'return' || tipoVenta === 'return-void') {
          invoice = resolveInvoice(invoice);
        }

        totalsMap.set(invoice, (totalsMap.get(invoice) ?? 0) + total);
      }

      return Array.from(totalsMap.entries()).map(([invoice, total]) => ({
        U_INVOICE: invoice,
        U_TOTAL: total.toLocaleString('es-CO'),
      }));
    }

    if (stage === 'ps_ck_intfc_vtapos') {
      // UNIQUE on INVOICE + SUMIF (sum TOTAL where INVOICE matches)
      const totalsMap = new Map<string, number>();
      for (const r of rows) {
        const invoice = r['invoice'] ?? '';
        const total = parseMonetaryValue(r['total'] ?? '0');
        totalsMap.set(invoice, (totalsMap.get(invoice) ?? 0) + total);
      }

      return Array.from(totalsMap.entries()).map(([invoice, total]) => ({
        U_INVOICE: invoice,
        U_TOTAL: total.toLocaleString('es-CO'),
      }));
    }

    // For other stages, return raw data as-is
    return rows;
  }

  /** Filter rows by search query matching invoice or total/amount columns. */
  function filterRows(rows: Record<string, string>[], query: string): Record<string, string>[] {
    if (!query.trim()) return rows;
    const q = query.toLowerCase().trim();
    return rows.filter((row) =>
      Object.entries(row).some(([key, val]) => {
        const k = key.toLowerCase();
        return (k.includes('invoice') || k.includes('total')) && val.toLowerCase().includes(q);
      }),
    );
  }

  const filteredRaw = filterRows(rawData, searchQuery);
  const filteredTransformed = filterRows(transformedRows, searchQuery);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} role="region" aria-label="Carga de archivos">
      <Typography variant="h4" component="h1">Carga de Archivos</Typography>

      <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} aria-label="Pestañas de carga">
        <Tab label="Cargar Archivo" />
        <Tab label="Vista Previa / Transformación" />
      </Tabs>

      {tabIndex === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <FileUploadForm onUploadComplete={() => setRefreshTrigger((n) => n + 1)} />
          <UploadHistory refreshTrigger={refreshTrigger} onPreview={handlePreview} />
        </Box>
      )}

      {tabIndex === 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {!selectedRecord ? (
            <Alert severity="info">
              Selecciona un archivo desde el historial de cargas para ver la vista previa.
            </Alert>
          ) : loadingPreview ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : previewError ? (
            <Alert severity="error">{previewError}</Alert>
          ) : (
            <>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" gutterBottom>
                  Archivo: {selectedRecord.fileName} — Etapa: {STAGE_DISPLAY_NAMES[selectedRecord.stage] ?? selectedRecord.stage}
                </Typography>
                <TextField
                  size="small"
                  placeholder="Buscar por invoice o monto..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> } }}
                  sx={{ mt: 1, minWidth: 320 }}
                  aria-label="Buscar por invoice o monto"
                />
              </Paper>

              {/* Raw data table */}
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Datos Crudos ({filteredRaw.length}{searchQuery ? ` de ${rawData.length}` : ''} filas)
                </Typography>
                <DataTable rows={filteredRaw} maxHeight={350} filterable />
              </Paper>

              {/* Transformed data table */}
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Datos Transformados ({filteredTransformed.length}{searchQuery ? ` de ${transformedRows.length}` : ''} filas)
                </Typography>
                <DataTable rows={filteredTransformed} maxHeight={350} />
              </Paper>
            </>
          )}

          <Button variant="outlined" onClick={() => setTabIndex(0)}>
            ← Volver a Cargar Archivo
          </Button>
        </Box>
      )}
    </Box>
  );
}

/** Format cell value — convert scientific notation to integer for display. */
function formatCellValue(col: string, value: string): string {
  // Columns that should display as integers (no scientific notation)
  const integerColumns = ['inv_item_id'];
  if (integerColumns.includes(col.toLowerCase()) && value) {
    // Handle European scientific notation: "7,70595E+12" → replace comma with dot
    const normalized = value.replace(',', '.');
    const num = parseFloat(normalized);
    if (!isNaN(num) && (value.includes('E') || value.includes('e'))) {
      return Math.round(num).toString();
    }
  }
  return value;
}

/** Generic data table component for displaying record arrays. */
function DataTable({ rows, maxHeight = 400, filterable = false }: { rows: Record<string, string>[]; maxHeight?: number; filterable?: boolean }) {
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  if (rows.length === 0) return <Typography color="text.secondary">Sin datos.</Typography>;

  const columns = Object.keys(rows[0]);

  const filtered = filterable
    ? rows.filter((row) =>
        Object.entries(columnFilters).every(([col, filter]) => {
          if (!filter.trim()) return true;
          const val = formatCellValue(col, row[col] ?? '');
          return val.toLowerCase().includes(filter.toLowerCase().trim());
        }),
      )
    : rows;

  const handleFilterChange = (col: string, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [col]: value }));
  };

  return (
    <>
      {filterable && Object.values(columnFilters).some((v) => v.trim()) && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
          Mostrando {filtered.length} de {rows.length} filas
        </Typography>
      )}
      <TableContainer sx={{ maxHeight }}>
        <Table size="small" stickyHeader aria-label="Tabla de datos">
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col} sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{col}</TableCell>
              ))}
            </TableRow>
            {filterable && (
              <TableRow>
                {columns.map((col) => (
                  <TableCell key={`filter-${col}`} sx={{ p: 0.5, top: 37 }}>
                    <input
                      type="text"
                      placeholder="Filtrar..."
                      value={columnFilters[col] ?? ''}
                      onChange={(e) => handleFilterChange(col, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        fontSize: '0.75rem',
                        border: '1px solid #ccc',
                        borderRadius: 4,
                        boxSizing: 'border-box',
                      }}
                      aria-label={`Filtrar columna ${col}`}
                    />
                  </TableCell>
                ))}
              </TableRow>
            )}
          </TableHead>
          <TableBody>
            {filtered.map((row, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col} sx={{ whiteSpace: 'nowrap' }}>{formatCellValue(col, row[col])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
