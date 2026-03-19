/**
 * DiscrepanciesPage — compara datos entre etapas consecutivas usando
 * los archivos ya subidos en la plataforma.
 *
 * Flujo:
 *  1. Carga los uploads existentes de DynamoDB.
 *  2. El usuario selecciona un par de etapas y los uploads a comparar.
 *  3. Descarga los CSVs de S3, transforma y compara.
 *  4. Muestra las discrepancias en una tabla.
 */
import { useState, useEffect, useCallback } from 'react';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import { getUrl } from 'aws-amplify/storage';
import type { CascadeStage } from '../../types/csv';
import type {
  Discrepancy,
  ComparisonResult,
  DiscrepancySeverity,
} from '../../types/comparison';
import type { UploadRecord } from '../../types/upload';
import { comparisonService } from '../../services/comparison';
import { uploadService } from '../../services/upload';
import { parseGeoposCSV } from '../../services/transform/geopos';
import { parseIntegracionCSV } from '../../services/transform/integracion';
import { parsePsCkCSV } from '../../services/transform/psck';
import { transformGeopos } from '../../services/transform/geopos';
import { transformIntegracion } from '../../services/transform/integracion';
import { transformPsCk } from '../../services/transform/psck';
import type { TransformedData } from '../../services/transform/types';

const COMPARISON_PAIRS: {
  source: CascadeStage;
  target: CascadeStage;
  label: string;
}[] = [
  { source: 'geopos_local', target: 'geopos_central', label: 'Geopos Local → Geopos Central' },
  { source: 'geopos_central', target: 'integracion', label: 'Geopos Central → Integración' },
  { source: 'integracion', target: 'ps_ck_intfc_vtapos', label: 'Integración → PS_CK' },
];

const SEVERITY_COLORS: Record<DiscrepancySeverity, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
};

const TYPE_LABELS: Record<string, string> = {
  missing_invoice: 'Factura faltante',
  total_difference: 'Diferencia de total',
  item_count_difference: 'Diferencia de ítems',
  missing_item: 'Ítem faltante',
};

function transformCSV(content: string, stage: CascadeStage, uploadId: string): TransformedData {
  switch (stage) {
    case 'geopos_local':
    case 'geopos_central':
      return transformGeopos(parseGeoposCSV(content), stage, uploadId);
    case 'integracion':
      return transformIntegracion(parseIntegracionCSV(content), uploadId);
    case 'ps_ck_intfc_vtapos':
      return transformPsCk(parsePsCkCSV(content), uploadId);
  }
}

async function downloadCSVFromS3(s3Key: string): Promise<string> {
  const { url } = await getUrl({
    path: s3Key,
    options: { bucket: 'reconciliationStorage', validateObjectExistence: true },
  });
  const response = await fetch(url.toString());
  return response.text();
}

export default function DiscrepanciesPage() {
  const [pairIndex, setPairIndex] = useState<number>(0);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [sourceUploadId, setSourceUploadId] = useState<string>('');
  const [targetUploadId, setTargetUploadId] = useState<string>('');
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pair = COMPARISON_PAIRS[pairIndex];

  // Load uploads from DynamoDB
  useEffect(() => {
    async function load() {
      setLoadingUploads(true);
      try {
        const { items } = await uploadService.getUploadHistory(undefined, null, 100);
        setUploads(items);
      } catch {
        setError('Error al cargar los uploads');
      } finally {
        setLoadingUploads(false);
      }
    }
    load();
  }, []);

  const sourceUploads = uploads.filter((u) => u.stage === pair.source);
  const targetUploads = uploads.filter((u) => u.stage === pair.target);

  // Reset selections when pair changes
  useEffect(() => {
    setSourceUploadId('');
    setTargetUploadId('');
    setResult(null);
  }, [pairIndex]);

  const handleCompare = useCallback(async () => {
    const sourceUpload = uploads.find((u) => u.uploadId === sourceUploadId);
    const targetUpload = uploads.find((u) => u.uploadId === targetUploadId);
    if (!sourceUpload || !targetUpload) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const [sourceContent, targetContent] = await Promise.all([
        downloadCSVFromS3(sourceUpload.s3Key),
        downloadCSVFromS3(targetUpload.s3Key),
      ]);

      const sourceData = transformCSV(sourceContent, pair.source, sourceUpload.uploadId);
      const targetData = transformCSV(targetContent, pair.target, targetUpload.uploadId);
      const compResult = comparisonService.compareStages(sourceData, targetData);

      if (compResult.discrepancies.length > 0) {
        await comparisonService.saveDiscrepancies(compResult.discrepancies);
      }

      setResult(compResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al comparar archivos');
    } finally {
      setLoading(false);
    }
  }, [sourceUploadId, targetUploadId, uploads, pair]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5">Comparación de Discrepancias</Typography>

      <Paper sx={{ p: 3 }}>
        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel id="pair-select-label">Par de Comparación</InputLabel>
          <Select
            labelId="pair-select-label"
            value={pairIndex}
            label="Par de Comparación"
            onChange={(e) => setPairIndex(e.target.value as number)}
          >
            {COMPARISON_PAIRS.map((p, i) => (
              <MenuItem key={i} value={i}>{p.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {loadingUploads ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
            <FormControl sx={{ flex: 1, minWidth: 250 }}>
              <InputLabel id="source-select-label">
                Archivo Source ({pair.source})
              </InputLabel>
              <Select
                labelId="source-select-label"
                value={sourceUploadId}
                label={`Archivo Source (${pair.source})`}
                onChange={(e) => setSourceUploadId(e.target.value)}
              >
                {sourceUploads.length === 0 && (
                  <MenuItem disabled value="">
                    No hay archivos para esta etapa
                  </MenuItem>
                )}
                {sourceUploads.map((u) => (
                  <MenuItem key={u.uploadId} value={u.uploadId}>
                    {u.fileName} — {new Date(u.uploadedAt).toLocaleString()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl sx={{ flex: 1, minWidth: 250 }}>
              <InputLabel id="target-select-label">
                Archivo Target ({pair.target})
              </InputLabel>
              <Select
                labelId="target-select-label"
                value={targetUploadId}
                label={`Archivo Target (${pair.target})`}
                onChange={(e) => setTargetUploadId(e.target.value)}
              >
                {targetUploads.length === 0 && (
                  <MenuItem disabled value="">
                    No hay archivos para esta etapa
                  </MenuItem>
                )}
                {targetUploads.map((u) => (
                  <MenuItem key={u.uploadId} value={u.uploadId}>
                    {u.fileName} — {new Date(u.uploadedAt).toLocaleString()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}

        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <CompareArrowsIcon />}
          onClick={handleCompare}
          disabled={!sourceUploadId || !targetUploadId || loading}
        >
          {loading ? 'Comparando...' : 'Comparar Etapas'}
        </Button>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      {result && (
        <>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Resumen</Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Chip label={`Facturas comparadas: ${result.totalInvoicesCompared}`} />
              <Chip
                label={`Discrepancias: ${result.discrepancies.length}`}
                color={result.discrepancies.length > 0 ? 'error' : 'success'}
              />
              <Chip label={`Facturas faltantes: ${result.summary.missingInvoices}`} variant="outlined" />
              <Chip label={`Diferencias de total: ${result.summary.totalDifferences}`} variant="outlined" />
              <Chip label={`Diferencias de ítems: ${result.summary.itemCountDifferences}`} variant="outlined" />
              <Chip label={`Ítems faltantes: ${result.summary.missingItems}`} variant="outlined" />
            </Box>
          </Paper>

          {result.discrepancies.length > 0 ? (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Factura</TableCell>
                    <TableCell>Tipo</TableCell>
                    <TableCell>Severidad</TableCell>
                    <TableCell>Esperado</TableCell>
                    <TableCell>Encontrado</TableCell>
                    <TableCell>Detalle</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.discrepancies.map((d: Discrepancy) => (
                    <TableRow key={d.discrepancyId}>
                      <TableCell>{d.invoice}</TableCell>
                      <TableCell>{TYPE_LABELS[d.type] ?? d.type}</TableCell>
                      <TableCell>
                        <Chip label={d.severity} size="small" color={SEVERITY_COLORS[d.severity]} />
                      </TableCell>
                      <TableCell>{d.details.expectedValue ?? '—'}</TableCell>
                      <TableCell>{d.details.actualValue ?? '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.details.message}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Alert severity="success">
              No se encontraron discrepancias entre las etapas.
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
