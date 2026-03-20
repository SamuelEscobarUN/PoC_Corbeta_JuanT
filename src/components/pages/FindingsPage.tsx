/**
 * FindingsPage — genera hallazgos a partir de discrepancias usando
 * Amazon Bedrock Nova Premier vía custom query de AppSync.
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
  LinearProgress,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SearchIcon from '@mui/icons-material/Search';
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

const SEVERITY_COLORS: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
};

export default function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

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
      mapped.sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
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
    setProgress(0);

    try {
      // 1. Delete ALL existing findings first
      setProgress(5);
      const { data: oldFindings } = await client.models.Finding.list({ limit: 1000 });
      if (oldFindings && oldFindings.length > 0) {
        for (const f of oldFindings) {
          await client.models.Finding.delete({
            discrepancyId: f.discrepancyId,
            findingId: f.findingId,
          });
        }
      }
      setFindings([]);

      // 2. Load discrepancies — only from the most recent session
      const { data: discData } = await client.models.Discrepancy.list({ limit: 1000 });
      const allDiscs = (discData ?? []).map((d) => ({
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

      if (allDiscs.length === 0) {
        setError('No hay discrepancias para analizar. Primero ejecuta una comparación.');
        return;
      }

      // Find the most recent session
      const latestSession = allDiscs.reduce((latest, d) =>
        d.detectedAt > latest ? d.detectedAt : latest, '');
      // Get all discrepancies from the latest session (same detectedAt date prefix)
      const latestDatePrefix = latestSession.slice(0, 10); // YYYY-MM-DD
      const discrepancies = allDiscs.filter((d) => d.detectedAt.startsWith(latestDatePrefix));

      setProgress(15);

      // 3. Call Bedrock via custom query (batches of 20)
      const BATCH_SIZE = 20;
      let created = 0;
      const totalBatches = Math.ceil(discrepancies.length / BATCH_SIZE);

      for (let i = 0; i < discrepancies.length; i += BATCH_SIZE) {
        const batch = discrepancies.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        const payload = batch.map((d) => ({
          discrepancyId: d.discrepancyId,
          invoice: d.invoice,
          type: d.type,
          sourceStage: d.sourceStage,
          targetStage: d.targetStage,
          expectedValue: d.expectedValue ?? undefined,
          actualValue: d.actualValue ?? undefined,
        }));

        try {
          const { data: result } = await client.queries.analyzeFindings({
            discrepancies: JSON.stringify(payload),
          });

          const aiFindings: Array<{
            discrepancyId: string;
            explanation: string;
            probableCause: string;
            recommendation: string;
            severity: string;
          }> = result ? JSON.parse(result) : [];

          // 4. Save each finding to DynamoDB
          for (const af of aiFindings) {
            const findingId = crypto.randomUUID();
            await client.models.Finding.create({
              discrepancyId: af.discrepancyId,
              findingId,
              explanation: af.explanation,
              probableCause: af.probableCause,
              recommendation: af.recommendation,
              severity: (af.severity as 'low' | 'medium' | 'high' | 'critical') ?? 'medium',
              itemDetails: null,
              analyzedAt: new Date().toISOString(),
            });
            created++;
          }
        } catch (batchErr) {
          console.error(`Error en batch ${batchNum}:`, batchErr);
        }

        setProgress(15 + Math.round((batchNum / totalBatches) * 80));
      }

      setProgress(100);
      setSuccessMsg(`Se generaron ${created} hallazgos con IA (Nova Premier) para ${discrepancies.length} discrepancias.`);
      await loadFindings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar hallazgos');
    } finally {
      setGenerating(false);
    }
  }, [loadFindings]);

  /** Clear all findings from DynamoDB */
  const handleClear = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const { data: allFindings } = await client.models.Finding.list({ limit: 1000 });
      if (allFindings && allFindings.length > 0) {
        for (const f of allFindings) {
          await client.models.Finding.delete({
            discrepancyId: f.discrepancyId,
            findingId: f.findingId,
          });
        }
        setSuccessMsg(`Se eliminaron ${allFindings.length} hallazgos.`);
      } else {
        setSuccessMsg('No hay hallazgos para eliminar.');
      }
      setFindings([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al limpiar hallazgos');
    } finally {
      setGenerating(false);
    }
  }, []);

  // Filtered findings
  const filtered = findings.filter((f) => {
    if (severityFilter && f.severity !== severityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        f.explanation.toLowerCase().includes(q) ||
        f.probableCause.toLowerCase().includes(q) ||
        f.recommendation.toLowerCase().includes(q) ||
        f.discrepancyId.toLowerCase().includes(q)
      );
    }
    return true;
  });

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
          Genera hallazgos automáticos usando Amazon Bedrock (Nova Premier) a partir de las discrepancias detectadas.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            startIcon={generating ? <CircularProgress size={20} color="inherit" /> : <AutoFixHighIcon />}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Analizando con IA...' : 'Generar Hallazgos con IA'}
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteSweepIcon />}
            onClick={handleClear}
            disabled={generating || findings.length === 0}
          >
            Limpiar Hallazgos
          </Button>
        </Box>
        {generating && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={progress} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              Procesando discrepancias con Nova Premier... {progress}%
            </Typography>
          </Box>
        )}
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {successMsg && <Alert severity="success">{successMsg}</Alert>}

      {findings.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Buscar en hallazgos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> } }}
              sx={{ minWidth: 250 }}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Severidad</InputLabel>
              <Select
                value={severityFilter}
                label="Severidad"
                onChange={(e) => setSeverityFilter(e.target.value)}
              >
                <MenuItem value="">Todas</MenuItem>
                <MenuItem value="critical">Crítico</MenuItem>
                <MenuItem value="high">Alto</MenuItem>
                <MenuItem value="medium">Medio</MenuItem>
                <MenuItem value="low">Bajo</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              {filtered.length} de {findings.length} hallazgos
            </Typography>
          </Box>

          <TableContainer sx={{ maxHeight: 600 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Severidad</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Explicación</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Causa Probable</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Recomendación</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Fecha</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((f) => (
                  <TableRow key={f.findingId}>
                    <TableCell>
                      <Chip
                        label={SEVERITY_LABELS[f.severity] ?? f.severity}
                        size="small"
                        color={SEVERITY_COLORS[f.severity] ?? 'default'}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>{f.explanation}</TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>{f.probableCause}</TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>{f.recommendation}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {new Date(f.analyzedAt).toLocaleDateString('es-CO')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {findings.length === 0 && !error && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No hay hallazgos registrados. Haz clic en "Generar Hallazgos con IA" para
            analizar las discrepancias con Nova Premier.
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
