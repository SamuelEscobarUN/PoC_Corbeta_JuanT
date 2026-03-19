/**
 * DiscrepanciesPage — comparación en cascada de los 4 archivos.
 *
 * Referencia: Geopos Local.
 * Cascada: Geopos Local → Geopos Central → Integración → PS_CK
 *
 * Descarga los 4 archivos en paralelo, transforma a Map<invoice, total>,
 * compara cada etapa contra la referencia y detecta:
 *  - Facturas faltantes (en qué tabla no está)
 *  - Diferencias de monto
 *  - Totales negativos (validación)
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  CircularProgress,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import SearchIcon from '@mui/icons-material/Search';
import type { CascadeStage } from '../../types/csv';
import type { UploadRecord } from '../../types/upload';
import { uploadService } from '../../services/upload';
import { parseCSV, parseMonetaryValue } from '../../services/csv-validator';
import { comparisonService } from '../../services/comparison';
import { STAGE_DISPLAY_NAMES } from '../organisms/FileUploadForm';

/** Stage labels in cascade order. */
const CASCADE_STAGES: CascadeStage[] = [
  'geopos_local',
  'geopos_central',
  'integracion',
  'ps_ck_intfc_vtapos',
];

type DiscrepancyType = 'missing' | 'total_diff' | 'negative_total';

interface CascadeDiscrepancy {
  invoice: string;
  type: DiscrepancyType;
  stage: CascadeStage;
  refTotal: number;
  stageTotal: number | null;
  difference: number;
  /** Presence in each stage: true = present */
  presence: Record<CascadeStage, boolean>;
}

interface CascadeSummary {
  totalRef: number;
  totalMatched: number;
  totalWithDiscrepancies: number;
  totalMissing: number;
  totalDifferences: number;
  totalNegatives: number;
  totalDiffAmount: number;
}

/**
 * Transform CSV rows to a Map<invoice, total> using the same logic
 * as UploadPage preview transformations.
 */
function buildInvoiceMap(
  rows: Record<string, string>[],
  stage: CascadeStage,
  geoposLocalRows?: Record<string, string>[],
): Map<string, number> {
  const map = new Map<string, number>();

  if (stage === 'geopos_local' || stage === 'geopos_central') {
    // UNIQUE + XLOOKUP (first match)
    for (const r of rows) {
      const invoice = r['invoice'] ?? '';
      if (!map.has(invoice)) {
        map.set(invoice, parseMonetaryValue(r['total'] ?? '0'));
      }
    }
    return map;
  }

  if (stage === 'integracion') {
    // Fix truncated invoices for return/return-void, then SUMIF.
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
      // 1. Suffix matching at multiple lengths (longest first for precision)
      for (let len = Math.min(truncated.length, 12); len >= 7; len--) {
        const suffix = truncated.slice(-len);
        const candidates = geoposSuffixMaps.get(len)?.get(suffix);
        if (candidates && candidates.length === 1) return candidates[0];
      }
      // 2. GL invoice contains the truncated invoice as substring
      const containsMatches = geoposInvoices.filter((g) => g.includes(truncated));
      if (containsMatches.length === 1) return containsMatches[0];
      // 3. Truncated ends with same chars as a GL invoice
      for (let len = Math.min(truncated.length, 12); len >= 7; len--) {
        const suffix = truncated.slice(-len);
        const candidates = geoposSuffixMaps.get(len)?.get(suffix);
        if (candidates && candidates.length > 0) return candidates[0];
      }
      return truncated;
    }

    for (const r of rows) {
      const tipoVenta = (r['tipo_venta'] ?? '').toLowerCase().trim();
      let invoice = r['invoice'] ?? '';
      const total = parseMonetaryValue(r['total'] ?? '0');

      if (tipoVenta === 'return' || tipoVenta === 'return-void') {
        invoice = resolveInvoice(invoice);
      }

      map.set(invoice, (map.get(invoice) ?? 0) + total);
    }
    return map;
  }

  // ps_ck_intfc_vtapos — SUMIF
  for (const r of rows) {
    const invoice = r['invoice'] ?? '';
    const total = parseMonetaryValue(r['total'] ?? '0');
    map.set(invoice, (map.get(invoice) ?? 0) + total);
  }
  return map;
}

export default function DiscrepanciesPage() {
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [selectedUploads, setSelectedUploads] = useState<Record<CascadeStage, string>>({
    geopos_local: '',
    geopos_central: '',
    integracion: '',
    ps_ck_intfc_vtapos: '',
  });
  const [loading, setLoading] = useState(false);
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [error, setError] = useState('');
  const [discrepancies, setDiscrepancies] = useState<CascadeDiscrepancy[]>([]);
  const [summary, setSummary] = useState<CascadeSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<DiscrepancyType | ''>('');

  // Load uploads
  useEffect(() => {
    (async () => {
      setLoadingUploads(true);
      try {
        const { items } = await uploadService.getUploadHistory(undefined, null, 200);
        setUploads(items);
        // Auto-select most recent upload per stage
        const auto: Record<string, string> = {};
        for (const stage of CASCADE_STAGES) {
          const stageUploads = items
            .filter((u) => u.stage === stage)
            .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
          if (stageUploads.length > 0) auto[stage] = stageUploads[0].uploadId;
        }
        setSelectedUploads((prev) => ({ ...prev, ...auto }));
      } catch {
        setError('Error al cargar los uploads.');
      } finally {
        setLoadingUploads(false);
      }
    })();
  }, []);

  const canCompare = CASCADE_STAGES.every((s) => selectedUploads[s]);

  const handleCompare = async () => {
    setLoading(true);
    setError('');
    setDiscrepancies([]);
    setSummary(null);

    try {
      // 1. Download all 4 files in parallel
      const uploadRecords = CASCADE_STAGES.map((s) =>
        uploads.find((u) => u.uploadId === selectedUploads[s]),
      );
      if (uploadRecords.some((u) => !u)) {
        setError('Faltan archivos seleccionados.');
        setLoading(false);
        return;
      }

      const contents = await Promise.all(
        uploadRecords.map((u) => uploadService.downloadFile(u!.s3Key)),
      );

      // 2. Parse all CSVs
      const parsedRows = contents.map((c) => parseCSV(c));

      // 3. Build invoice maps (integracion needs geopos_local reference)
      const maps: Map<string, number>[] = CASCADE_STAGES.map((stage, i) =>
        buildInvoiceMap(parsedRows[i], stage, stage === 'integracion' ? parsedRows[0] : undefined),
      );

      const [refMap, gcMap, intMap, psckMap] = maps;
      const allMaps: Record<CascadeStage, Map<string, number>> = {
        geopos_local: refMap,
        geopos_central: gcMap,
        integracion: intMap,
        ps_ck_intfc_vtapos: psckMap,
      };

      // 4. Compare: reference is always Geopos Local
      const discs: CascadeDiscrepancy[] = [];
      let totalMissing = 0;
      let totalDiffs = 0;
      let totalNegs = 0;
      let totalDiffAmount = 0;
      const invoicesWithDisc = new Set<string>();

      // Check each reference invoice against all other stages
      for (const [invoice, refTotal] of refMap) {
        const presence: Record<CascadeStage, boolean> = {
          geopos_local: true,
          geopos_central: gcMap.has(invoice),
          integracion: intMap.has(invoice),
          ps_ck_intfc_vtapos: psckMap.has(invoice),
        };

        // Negative total validation on reference
        if (refTotal < 0) {
          discs.push({
            invoice, type: 'negative_total', stage: 'geopos_local',
            refTotal, stageTotal: refTotal, difference: 0, presence,
          });
          totalNegs++;
          invoicesWithDisc.add(invoice);
        }

        for (const stage of CASCADE_STAGES.slice(1)) {
          const stageMap = allMaps[stage];
          const stageTotal = stageMap.get(invoice);

          if (stageTotal === undefined) {
            // Missing in this stage
            discs.push({
              invoice, type: 'missing', stage,
              refTotal, stageTotal: null, difference: refTotal, presence,
            });
            totalMissing++;
            invoicesWithDisc.add(invoice);
          } else {
            // Negative total validation
            if (stageTotal < 0) {
              discs.push({
                invoice, type: 'negative_total', stage,
                refTotal, stageTotal, difference: 0, presence,
              });
              totalNegs++;
              invoicesWithDisc.add(invoice);
            }
            // Total difference
            const diff = refTotal - stageTotal;
            if (Math.abs(diff) > 0.01) {
              discs.push({
                invoice, type: 'total_diff', stage,
                refTotal, stageTotal, difference: diff, presence,
              });
              totalDiffs++;
              totalDiffAmount += Math.abs(diff);
              invoicesWithDisc.add(invoice);
            }
          }
        }
      }

      // Check for orphan invoices (in other stages but NOT in reference)
      for (const stage of CASCADE_STAGES.slice(1)) {
        for (const [invoice, stageTotal] of allMaps[stage]) {
          if (!refMap.has(invoice)) {
            const presence: Record<CascadeStage, boolean> = {
              geopos_local: false,
              geopos_central: gcMap.has(invoice),
              integracion: intMap.has(invoice),
              ps_ck_intfc_vtapos: psckMap.has(invoice),
            };
            discs.push({
              invoice, type: 'missing', stage: 'geopos_local',
              refTotal: 0, stageTotal, difference: -stageTotal, presence,
            });
            totalMissing++;
            invoicesWithDisc.add(invoice);
          }
        }
      }

      setSummary({
        totalRef: refMap.size,
        totalMatched: refMap.size - invoicesWithDisc.size,
        totalWithDiscrepancies: invoicesWithDisc.size,
        totalMissing,
        totalDifferences: totalDiffs,
        totalNegatives: totalNegs,
        totalDiffAmount,
      });
      setDiscrepancies(discs);

      // Save to DynamoDB
      if (discs.length > 0) {
        const sessionId = crypto.randomUUID();
        const toSave = discs.slice(0, 500).map((d) => ({
          discrepancyId: crypto.randomUUID(),
          sourceStage: 'geopos_local' as CascadeStage,
          targetStage: d.stage,
          invoice: d.invoice,
          type: d.type === 'missing' ? 'missing_invoice' as const : d.type === 'total_diff' ? 'total_difference' as const : 'missing_invoice' as const,
          details: {
            expectedValue: String(d.refTotal),
            actualValue: d.stageTotal !== null ? String(d.stageTotal) : 'N/A',
            message: d.type === 'missing'
              ? `Factura ${d.invoice} no encontrada en ${STAGE_DISPLAY_NAMES[d.stage]}`
              : d.type === 'negative_total'
              ? `Total negativo en ${STAGE_DISPLAY_NAMES[d.stage]}: ${d.stageTotal}`
              : `Diferencia de $${Math.abs(d.difference).toLocaleString('es-CO')} en ${STAGE_DISPLAY_NAMES[d.stage]}`,
          },
          severity: d.type === 'missing' ? 'high' as const : 'medium' as const,
          detectedAt: new Date().toISOString(),
        }));
        await comparisonService.saveDiscrepancies(toSave, sessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al comparar archivos.');
    } finally {
      setLoading(false);
    }
  };

  // Filtered discrepancies
  const filtered = useMemo(() => {
    let result = discrepancies;
    if (typeFilter) result = result.filter((d) => d.type === typeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((d) => d.invoice.toLowerCase().includes(q));
    }
    return result;
  }, [discrepancies, typeFilter, searchQuery]);

  const TYPE_LABELS: Record<DiscrepancyType, string> = {
    missing: 'Factura faltante',
    total_diff: 'Diferencia de monto',
    negative_total: 'Total negativo',
  };

  const TYPE_COLORS: Record<DiscrepancyType, 'error' | 'warning' | 'info'> = {
    missing: 'error',
    total_diff: 'warning',
    negative_total: 'error',
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5">Comparación en Cascada</Typography>

      {/* File selectors */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" gutterBottom>
          Seleccionar archivos por etapa (referencia: Geopos Local)
        </Typography>
        {loadingUploads ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
            {CASCADE_STAGES.map((stage) => {
              const stageUploads = uploads
                .filter((u) => u.stage === stage)
                .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
              return (
                <FormControl key={stage} sx={{ flex: 1, minWidth: 200 }}>
                  <InputLabel>{STAGE_DISPLAY_NAMES[stage]}</InputLabel>
                  <Select
                    value={selectedUploads[stage]}
                    label={STAGE_DISPLAY_NAMES[stage]}
                    onChange={(e) =>
                      setSelectedUploads((prev) => ({ ...prev, [stage]: e.target.value }))
                    }
                    size="small"
                  >
                    {stageUploads.length === 0 && (
                      <MenuItem disabled value="">Sin archivos</MenuItem>
                    )}
                    {stageUploads.map((u) => (
                      <MenuItem key={u.uploadId} value={u.uploadId}>
                        {u.fileName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              );
            })}
          </Box>
        )}

        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <CompareArrowsIcon />}
          onClick={handleCompare}
          disabled={!canCompare || loading}
        >
          {loading ? 'Comparando...' : 'Ejecutar Comparación en Cascada'}
        </Button>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Summary */}
      {summary && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>Resumen</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <Chip label={`Facturas referencia: ${summary.totalRef.toLocaleString()}`} />
            <Chip label={`Sin discrepancias: ${summary.totalMatched.toLocaleString()}`} color="success" />
            <Chip label={`Con discrepancias: ${summary.totalWithDiscrepancies.toLocaleString()}`} color={summary.totalWithDiscrepancies > 0 ? 'error' : 'success'} />
            <Chip label={`Faltantes: ${summary.totalMissing.toLocaleString()}`} variant="outlined" color="error" />
            <Chip label={`Diferencias: ${summary.totalDifferences.toLocaleString()}`} variant="outlined" color="warning" />
            <Chip label={`Negativos: ${summary.totalNegatives.toLocaleString()}`} variant="outlined" color="error" />
            <Chip label={`Monto total diferencias: $${summary.totalDiffAmount.toLocaleString('es-CO')}`} variant="outlined" />
          </Box>
        </Paper>
      )}

      {/* Discrepancies table */}
      {discrepancies.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Buscar por invoice..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> } }}
              sx={{ minWidth: 250 }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Tipo</InputLabel>
              <Select
                value={typeFilter}
                label="Tipo"
                onChange={(e) => setTypeFilter(e.target.value as DiscrepancyType | '')}
              >
                <MenuItem value="">Todos</MenuItem>
                <MenuItem value="missing">Faltante</MenuItem>
                <MenuItem value="total_diff">Diferencia</MenuItem>
                <MenuItem value="negative_total">Negativo</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              {filtered.length} de {discrepancies.length} discrepancias
            </Typography>
          </Box>

          <TableContainer sx={{ maxHeight: 500 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Invoice</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Tipo</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Tabla afectada</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Total Ref (GL)</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Total Etapa</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Diferencia</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="center">GL</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="center">GC</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="center">INT</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="center">PSCK</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((d, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{d.invoice}</TableCell>
                    <TableCell>
                      <Chip label={TYPE_LABELS[d.type]} size="small" color={TYPE_COLORS[d.type]} />
                    </TableCell>
                    <TableCell>{STAGE_DISPLAY_NAMES[d.stage]}</TableCell>
                    <TableCell align="right">${d.refTotal.toLocaleString('es-CO')}</TableCell>
                    <TableCell align="right">
                      {d.stageTotal !== null ? `$${d.stageTotal.toLocaleString('es-CO')}` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: d.difference > 0 ? 'error.main' : d.difference < 0 ? 'warning.main' : 'inherit' }}>
                      {d.type !== 'negative_total' ? `$${d.difference.toLocaleString('es-CO')}` : '—'}
                    </TableCell>
                    {CASCADE_STAGES.map((s) => (
                      <TableCell key={s} align="center">
                        {d.presence[s] ? '✓' : '✗'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {summary && discrepancies.length === 0 && (
        <Alert severity="success">
          No se encontraron discrepancias. Todas las facturas coinciden en las 4 etapas.
        </Alert>
      )}
    </Box>
  );
}
