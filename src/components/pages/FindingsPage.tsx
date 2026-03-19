/**
 * FindingsPage — genera y muestra hallazgos a partir de las discrepancias
 * detectadas. Usa análisis determinista (sin IA) cuando Bedrock no está
 * disponible.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  CircularProgress,
  Button,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';

const client = generateClient<Schema>();

interface Finding {
  findingId: string;
  discrepancyId: string;
  explanation: string;
  probableCause: string;
  recommendation: string;
  severity: string;
  analyzedAt: string;
}

interface DiscrepancyRecord {
  sessionId: string;
  discrepancyId: string;
  invoice: string;
  type: string;
  sourceStage: string;
  targetStage: string;
  expectedValue?: string | null;
  actualValue?: string | null;
  detectedAt: string;
}

const SEVERITY_COLORS: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
};

/** Genera un finding determinista a partir de una discrepancia. */
function generateFindingFromDiscrepancy(disc: DiscrepancyRecord): Omit<Finding, 'findingId'> {
  const now = new Date().toISOString();
  let explanation = '';
  let probableCause = '';
  let recommendation = '';
  let severity = 'medium';

  switch (disc.type) {
    case 'missing_invoice':
      explanation = `La factura ${disc.invoice} está presente en ${disc.sourceStage} pero no aparece en ${disc.targetStage}.`;
      probableCause = 'Error en la transmisión de datos entre etapas o retraso en el procesamiento.';
      recommendation = 'Verificar el proceso de sincronización entre etapas y reprocesar la factura.';
      severity = 'high';
      break;
    case 'total_difference':
      explanation = `El total de la factura ${disc.invoice} difiere: ${disc.expectedValue ?? '?'} en origen vs ${disc.actualValue ?? '?'} en destino.`;
      probableCause = 'Diferencia en el cálculo de impuestos, descuentos o redondeo entre sistemas.';
      recommendation = 'Revisar las reglas de cálculo de totales en ambas etapas y corregir la diferencia.';
      severity = 'medium';
      break;
    case 'item_count_difference':
      explanation = `La factura ${disc.invoice} tiene ${disc.expectedValue ?? '?'} ítems en origen pero ${disc.actualValue ?? '?'} en destino.`;
      probableCause = 'Ítems filtrados, duplicados o no procesados durante la transformación.';
      recommendation = 'Comparar los ítems individuales para identificar cuáles faltan o sobran.';
      severity = 'medium';
      break;
    case 'missing_item':
      explanation = `El ítem ${disc.expectedValue ?? '?'} de la factura ${disc.invoice} no aparece en ${disc.targetStage}.`;
      probableCause = 'El ítem fue excluido durante la transformación o no cumplió criterios de validación.';
      recommendation = 'Verificar las reglas de transformación y validación para este tipo de ítem.';
      severity = 'high';
      break;
    default:
      explanation = `Discrepancia detectada en factura ${disc.invoice}.`;
      probableCause = 'Causa no determinada.';
      recommendation = 'Revisar manualmente la discrepancia.';
  }

  return { discrepancyId: disc.discrepancyId, explanation, probableCause, recommendation, severity, analyzedAt: now };
}

export default function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadFindings = useCallback(async () => {
    try {
      const { data } = await client.models.Finding.list({ limit: 1000 });
      const mapped: Finding[] = (data ?? []).map((f) => ({
        findingId: f.findingId,
        discrepancyId: f.discrepancyId,
        explanation: f.explanation,
        probableCause: f.probableCause,
        recommendation: f.recommendation,
        severity: f.severity ?? 'medium',
        analyzedAt: f.analyzedAt,
      }));
      setFindings(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar hallazgos');
    }
  }, []);

  useEffect(() => {
    loadFindings().finally(() => setLoading(false));
  }, [loadFindings]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // 1. Load all discrepancies
      const { data: discData } = await client.models.Discrepancy.list({ limit: 1000 });
      const discrepancies: DiscrepancyRecord[] = (discData ?? []).map((d) => ({
        sessionId: d.sessionId,
        discrepancyId: d.discrepancyId,
        invoice: d.invoice,
        type: d.type ?? '',
        sourceStage: d.sourceStage,
        targetStage: d.targetStage,
        expectedValue: d.expectedValue,
        actualValue: d.actualValue,
        detectedAt: d.detectedAt,
      }));

      if (discrepancies.length === 0) {
        setError('No hay discrepancias para analizar. Primero ejecuta una comparación.');
        return;
      }

      // 2. Get existing finding discrepancyIds to avoid duplicates
      const { data: existingFindings } = await client.models.Finding.list({ limit: 1000 });
      const existingDiscIds = new Set((existingFindings ?? []).map((f) => f.discrepancyId));

      // 3. Generate findings for discrepancies without existing findings
      const newDiscrepancies = discrepancies.filter((d) => !existingDiscIds.has(d.discrepancyId));

      if (newDiscrepancies.length === 0) {
        setSuccessMsg('Todos los hallazgos ya fueron generados previamente.');
        await loadFindings();
        return;
      }

      let created = 0;
      for (const disc of newDiscrepancies) {
        const finding = generateFindingFromDiscrepancy(disc);
        const findingId = crypto.randomUUID();
        await client.models.Finding.create({
          discrepancyId: finding.discrepancyId,
          findingId,
          explanation: finding.explanation,
          probableCause: finding.probableCause,
          recommendation: finding.recommendation,
          severity: finding.severity as 'low' | 'medium' | 'high' | 'critical',
          itemDetails: null,
          analyzedAt: finding.analyzedAt,
        });
        created++;
      }

      setSuccessMsg(`Se generaron ${created} hallazgos nuevos.`);
      await loadFindings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar hallazgos');
    } finally {
      setGenerating(false);
    }
  }, [loadFindings]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5">Hallazgos</Typography>

      <Paper sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Genera hallazgos automáticos a partir de las discrepancias detectadas.
        </Typography>
        <Button
          variant="contained"
          startIcon={generating ? <CircularProgress size={20} color="inherit" /> : <AutoFixHighIcon />}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Generando hallazgos...' : 'Generar Hallazgos'}
        </Button>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {successMsg && <Alert severity="success">{successMsg}</Alert>}

      {findings.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No hay hallazgos registrados. Haz clic en "Generar Hallazgos" para
            analizar las discrepancias detectadas.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Factura / Discrepancia</TableCell>
                <TableCell>Severidad</TableCell>
                <TableCell>Explicación</TableCell>
                <TableCell>Causa Probable</TableCell>
                <TableCell>Recomendación</TableCell>
                <TableCell>Fecha</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {findings.map((f) => (
                <TableRow key={f.findingId}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {f.discrepancyId.slice(0, 8)}...
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={f.severity}
                      size="small"
                      color={SEVERITY_COLORS[f.severity] ?? 'default'}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 250 }}>{f.explanation}</TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>{f.probableCause}</TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>{f.recommendation}</TableCell>
                  <TableCell>{new Date(f.analyzedAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
