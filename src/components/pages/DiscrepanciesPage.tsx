/**
 * DiscrepanciesPage — comparación en cascada + hallazgos IA.
 *
 * Tab 1: Discrepancias (comparación de los 4 archivos)
 * Tab 2: Hallazgos IA (análisis con Bedrock Nova Premier)
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
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
  Tabs,
  Tab,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import SearchIcon from '@mui/icons-material/Search';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { sessionService } from '../../services/session';
import { useAuth } from '../../hooks/useAuth';
import type { CascadeStage } from '../../types/csv';
import type { UploadRecord } from '../../types/upload';
import type { Session } from '../../types/session';
import { uploadService } from '../../services/upload';
import { parseCSV, parseMonetaryValue } from '../../services/csv-validator';
import { comparisonService } from '../../services/comparison';
import { STAGE_DISPLAY_NAMES } from '../organisms/FileUploadForm';

const client = generateClient<Schema>();

const CASCADE_STAGES: CascadeStage[] = [
  'geopos_local', 'geopos_central', 'integracion', 'ps_ck_intfc_vtapos',
];

type DiscrepancyType = 'missing' | 'total_diff' | 'negative_total';

interface CascadeDiscrepancy {
  invoice: string;
  type: DiscrepancyType;
  stage: CascadeStage;
  refTotal: number;
  stageTotal: number | null;
  difference: number;
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

interface AIFinding {
  discrepancyId: string;
  invoice: string;
  explanation: string;
  probableCause: string;
  recommendation: string;
  severity: string;
}

const TYPE_LABELS: Record<DiscrepancyType, string> = {
  missing: 'Factura faltante',
  total_diff: 'Diferencia de monto',
  negative_total: 'Total negativo',
};
const TYPE_COLORS: Record<DiscrepancyType, 'error' | 'warning' | 'info'> = {
  missing: 'error', total_diff: 'warning', negative_total: 'error',
};
const SEVERITY_COLORS: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error', high: 'error', medium: 'warning', low: 'info',
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo',
};

/** Build invoice→total map with stage-specific transformations. */
function buildInvoiceMap(
  rows: Record<string, string>[],
  stage: CascadeStage,
  geoposLocalRows?: Record<string, string>[],
): Map<string, number> {
  const map = new Map<string, number>();

  if (stage === 'geopos_local' || stage === 'geopos_central') {
    for (const r of rows) {
      const invoice = r['invoice'] ?? '';
      if (!map.has(invoice)) map.set(invoice, parseMonetaryValue(r['total'] ?? '0'));
    }
    return map;
  }

  if (stage === 'integracion') {
    const geoposSuffixMaps = new Map<number, Map<string, string[]>>();
    const geoposInvoices: string[] = [];
    const SUFFIX_LENGTHS = [7, 8, 9, 10, 11, 12];
    if (geoposLocalRows) {
      for (const len of SUFFIX_LENGTHS) geoposSuffixMaps.set(len, new Map());
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
    function resolveInvoice(truncated: string): string {
      for (let len = Math.min(truncated.length, 12); len >= 7; len--) {
        const candidates = geoposSuffixMaps.get(len)?.get(truncated.slice(-len));
        if (candidates?.length === 1) return candidates[0];
      }
      const cm = geoposInvoices.filter((g) => g.includes(truncated));
      if (cm.length === 1) return cm[0];
      for (let len = Math.min(truncated.length, 12); len >= 7; len--) {
        const candidates = geoposSuffixMaps.get(len)?.get(truncated.slice(-len));
        if (candidates?.length) return candidates[0];
      }
      return truncated;
    }
    for (const r of rows) {
      const tipoVenta = (r['tipo_venta'] ?? '').toLowerCase().trim();
      let invoice = r['invoice'] ?? '';
      const total = parseMonetaryValue(r['total'] ?? '0');
      if (tipoVenta === 'return' || tipoVenta === 'return-void') invoice = resolveInvoice(invoice);
      map.set(invoice, (map.get(invoice) ?? 0) + total);
    }
    return map;
  }

  for (const r of rows) {
    const invoice = r['invoice'] ?? '';
    const total = parseMonetaryValue(r['total'] ?? '0');
    map.set(invoice, (map.get(invoice) ?? 0) + total);
  }
  return map;
}

export default function DiscrepanciesPage() {
  const { user } = useAuth();
  const [tabIndex, setTabIndex] = useState(0);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [selectedUploads, setSelectedUploads] = useState<Record<CascadeStage, string>>({
    geopos_local: '', geopos_central: '', integracion: '', ps_ck_intfc_vtapos: '',
  });
  const [loading, setLoading] = useState(false);
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [error, setError] = useState('');
  const [discrepancies, setDiscrepancies] = useState<CascadeDiscrepancy[]>([]);
  const [summary, setSummary] = useState<CascadeSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<DiscrepancyType | ''>('');

  // Session state
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Session auto-populate state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionForAutoPopulate, setSelectedSessionForAutoPopulate] = useState<string>('');

  // Findings state
  const [findings, setFindings] = useState<AIFinding[]>([]);
  const [generatingFindings, setGeneratingFindings] = useState(false);
  const [findingsProgress, setFindingsProgress] = useState(0);
  const [findingsError, setFindingsError] = useState('');
  const [findingsSuccess, setFindingsSuccess] = useState('');
  const [findingsSearch, setFindingsSearch] = useState('');
  const [findingsSeverity, setFindingsSeverity] = useState('');

  useEffect(() => {
    (async () => {
      setLoadingUploads(true);
      try {
        const { items } = await uploadService.getUploadHistory(undefined, null, 200);
        setUploads(items);
        const auto: Record<string, string> = {};
        for (const stage of CASCADE_STAGES) {
          const su = items.filter((u) => u.stage === stage).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
          if (su.length > 0) auto[stage] = su[0].uploadId;
        }
        setSelectedUploads((prev) => ({ ...prev, ...auto }));
      } catch { setError('Error al cargar los uploads.'); }
      finally { setLoadingUploads(false); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { items } = await sessionService.listSessions();
        setSessions(items);
      } catch {
        // Silently fail
      }
    })();
  }, []);

  const canCompare = CASCADE_STAGES.every((s) => selectedUploads[s]);

  /** Handle session auto-populate when user selects a session */
  const handleSessionAutoPopulate = async (e: SelectChangeEvent<string>) => {
    const sessionId = e.target.value;
    setSelectedSessionForAutoPopulate(sessionId);

    if (!sessionId) {
      // Reset to empty — user chose "Sin sesión"
      return;
    }

    try {
      const sessionUploads = await sessionService.getSessionUploads(sessionId);

      // Auto-populate the 4 dropdowns with uploads matching each stage
      const autoSelected: Record<string, string> = {};
      for (const stage of CASCADE_STAGES) {
        const stageUpload = sessionUploads.find((u) => u.stage === stage);
        if (stageUpload) {
          autoSelected[stage] = stageUpload.uploadId;
        }
      }

      setSelectedUploads((prev) => ({ ...prev, ...autoSelected }));

      // If the session has all 4 files, set it as the active session
      if (CASCADE_STAGES.every((s) => autoSelected[s])) {
        setActiveSessionId(sessionId);
      }
    } catch {
      // Silently fail — user can still select manually
    }
  };

  /** Open session name dialog when user clicks "Comparar" */
  const handleCompareClick = () => {
    if (selectedSessionForAutoPopulate && activeSessionId) {
      // Session already selected via auto-populate — skip dialog, run comparison directly
      setLoading(true);
      setError('');
      setDiscrepancies([]);
      setSummary(null);
      setFindings([]);
      setFindingsSuccess('');
      runComparison(activeSessionId).finally(() => setLoading(false));
      return;
    }
    setSessionDialogOpen(true);
    setSessionName('');
  };

  /** Cancel session dialog — do nothing */
  const handleSessionDialogCancel = () => {
    setSessionDialogOpen(false);
    setSessionName('');
  };

  /** Confirm session dialog — create session, then run comparison */
  const handleSessionDialogConfirm = async () => {
    if (!sessionName.trim()) return;
    setSessionDialogOpen(false);

    setLoading(true);
    setError('');
    setDiscrepancies([]);
    setSummary(null);
    setFindings([]);
    setFindingsSuccess('');
    setActiveSessionId(null);

    try {
      // Create session first
      const uploadIds = CASCADE_STAGES.map((s) => selectedUploads[s]);
      const session = await sessionService.createSession({
        sessionName: sessionName.trim(),
        uploadIds,
        createdBy: user?.email ?? 'unknown',
      });
      const sessionId = session.sessionId;
      setActiveSessionId(sessionId);

      // Now run the comparison
      await runComparison(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la sesión o comparar archivos.');
    } finally {
      setLoading(false);
    }
  };

  /** Execute the cascade comparison and save discrepancies with the given sessionId */
  const runComparison = async (sessionId: string) => {

    try {
      const uploadRecords = CASCADE_STAGES.map((s) => uploads.find((u) => u.uploadId === selectedUploads[s]));
      if (uploadRecords.some((u) => !u)) { setError('Faltan archivos seleccionados.'); setLoading(false); return; }

      const contents = await Promise.all(uploadRecords.map((u) => uploadService.downloadFile(u!.s3Key)));
      const parsedRows = contents.map((c) => parseCSV(c));
      const maps = CASCADE_STAGES.map((stage, i) =>
        buildInvoiceMap(parsedRows[i], stage, stage === 'integracion' ? parsedRows[0] : undefined));

      const [refMap, gcMap, intMap, psckMap] = maps;
      const allMaps: Record<CascadeStage, Map<string, number>> = {
        geopos_local: refMap, geopos_central: gcMap, integracion: intMap, ps_ck_intfc_vtapos: psckMap,
      };

      const discs: CascadeDiscrepancy[] = [];
      let totalMissing = 0, totalDiffs = 0, totalNegs = 0, totalDiffAmount = 0;
      const invoicesWithDisc = new Set<string>();

      for (const [invoice, refTotal] of refMap) {
        const presence: Record<CascadeStage, boolean> = {
          geopos_local: true, geopos_central: gcMap.has(invoice),
          integracion: intMap.has(invoice), ps_ck_intfc_vtapos: psckMap.has(invoice),
        };
        if (refTotal < 0) {
          discs.push({ invoice, type: 'negative_total', stage: 'geopos_local', refTotal, stageTotal: refTotal, difference: 0, presence });
          totalNegs++; invoicesWithDisc.add(invoice);
        }
        for (const stage of CASCADE_STAGES.slice(1)) {
          const stageTotal = allMaps[stage].get(invoice);
          if (stageTotal === undefined) {
            discs.push({ invoice, type: 'missing', stage, refTotal, stageTotal: null, difference: refTotal, presence });
            totalMissing++; invoicesWithDisc.add(invoice);
          } else {
            if (stageTotal < 0) {
              discs.push({ invoice, type: 'negative_total', stage, refTotal, stageTotal, difference: 0, presence });
              totalNegs++; invoicesWithDisc.add(invoice);
            }
            const diff = refTotal - stageTotal;
            if (Math.abs(diff) > 0.01) {
              discs.push({ invoice, type: 'total_diff', stage, refTotal, stageTotal, difference: diff, presence });
              totalDiffs++; totalDiffAmount += Math.abs(diff); invoicesWithDisc.add(invoice);
            }
          }
        }
      }
      for (const stage of CASCADE_STAGES.slice(1)) {
        for (const [invoice, stageTotal] of allMaps[stage]) {
          if (!refMap.has(invoice)) {
            const presence: Record<CascadeStage, boolean> = {
              geopos_local: false, geopos_central: gcMap.has(invoice),
              integracion: intMap.has(invoice), ps_ck_intfc_vtapos: psckMap.has(invoice),
            };
            discs.push({ invoice, type: 'missing', stage: 'geopos_local', refTotal: 0, stageTotal, difference: -stageTotal, presence });
            totalMissing++; invoicesWithDisc.add(invoice);
          }
        }
      }

      setSummary({
        totalRef: refMap.size, totalMatched: refMap.size - invoicesWithDisc.size,
        totalWithDiscrepancies: invoicesWithDisc.size, totalMissing, totalDifferences: totalDiffs,
        totalNegatives: totalNegs, totalDiffAmount,
      });
      setDiscrepancies(discs);

      if (discs.length > 0) {
        const toSave = discs.slice(0, 500).map((d) => ({
          discrepancyId: crypto.randomUUID(),
          sourceStage: 'geopos_local' as CascadeStage, targetStage: d.stage,
          invoice: d.invoice,
          type: d.type === 'missing' ? 'missing_invoice' as const : d.type === 'total_diff' ? 'total_difference' as const : 'missing_invoice' as const,
          details: {
            expectedValue: String(d.refTotal),
            actualValue: d.stageTotal !== null ? String(d.stageTotal) : 'N/A',
            message: d.type === 'missing' ? `Factura ${d.invoice} no encontrada en ${STAGE_DISPLAY_NAMES[d.stage]}`
              : d.type === 'negative_total' ? `Total negativo en ${STAGE_DISPLAY_NAMES[d.stage]}: ${d.stageTotal}`
              : `Diferencia de ${Math.abs(d.difference).toLocaleString('es-CO')} en ${STAGE_DISPLAY_NAMES[d.stage]}`,
          },
          severity: d.type === 'missing' ? 'high' as const : 'medium' as const,
          detectedAt: new Date().toISOString(),
        }));
        await comparisonService.saveDiscrepancies(toSave, sessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al comparar archivos.');
    }
  };

  /** Generate AI findings from current in-memory discrepancies */
  const handleGenerateFindings = useCallback(async () => {
    if (discrepancies.length === 0) { setFindingsError('Primero ejecuta una comparación.'); return; }
    setGeneratingFindings(true);
    setFindingsError('');
    setFindingsSuccess('');
    setFindingsProgress(0);
    setFindings([]);

    try {
      const payload = discrepancies.map((d) => ({
        discrepancyId: crypto.randomUUID(),
        invoice: d.invoice,
        type: d.type === 'missing' ? 'missing_invoice' : d.type === 'total_diff' ? 'total_difference' : 'negative_total',
        sourceStage: 'geopos_local',
        targetStage: d.stage,
        expectedValue: String(d.refTotal),
        actualValue: d.stageTotal !== null ? String(d.stageTotal) : 'N/A',
      }));

      const BATCH_SIZE = 20;
      const allFindings: AIFinding[] = [];
      const totalBatches = Math.ceil(payload.length / BATCH_SIZE);

      for (let i = 0; i < payload.length; i += BATCH_SIZE) {
        const batch = payload.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        try {
          const { data: result } = await client.queries.analyzeFindings({
            discrepancies: JSON.stringify(batch),
          });
          const parsed: AIFinding[] = result ? JSON.parse(result) : [];
          // Attach invoice from payload
          const enriched = parsed.map((f, idx) => ({
            ...f,
            invoice: batch[idx]?.invoice ?? f.invoice ?? '',
          }));
          allFindings.push(...enriched);

          // Save findings to DynamoDB with sessionId
          if (activeSessionId) {
            for (const finding of enriched) {
              const findingId = crypto.randomUUID();
              try {
                await client.models.Finding.create({
                  discrepancyId: finding.discrepancyId,
                  findingId,
                  sessionId: activeSessionId,
                  explanation: finding.explanation,
                  probableCause: finding.probableCause,
                  recommendation: finding.recommendation,
                  severity: (finding.severity as 'low' | 'medium' | 'high' | 'critical') ?? 'medium',
                  itemDetails: null,
                  analyzedAt: new Date().toISOString(),
                });
              } catch (err) {
                console.error(`Error saving finding for ${finding.invoice}:`, err);
              }
            }
          }
        } catch (err) {
          console.error(`Error batch ${batchNum}:`, err);
        }
        setFindingsProgress(Math.round((batchNum / totalBatches) * 100));
      }

      setFindings(allFindings);

      // Update session counts
      if (activeSessionId) {
        try {
          await sessionService.updateSessionCounts(activeSessionId, discrepancies.length, allFindings.length);
        } catch (err) {
          console.error('Error updating session counts:', err);
        }
      }

      setFindingsSuccess(`Se generaron ${allFindings.length} hallazgos con Nova Premier.`);
      setTabIndex(1);
    } catch (err) {
      setFindingsError(err instanceof Error ? err.message : 'Error al generar hallazgos');
    } finally { setGeneratingFindings(false); }
  }, [discrepancies, activeSessionId]);

  const filtered = useMemo(() => {
    let result = discrepancies;
    if (typeFilter) result = result.filter((d) => d.type === typeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((d) => d.invoice.toLowerCase().includes(q));
    }
    return result;
  }, [discrepancies, typeFilter, searchQuery]);

  const filteredFindings = useMemo(() => {
    let result = findings;
    if (findingsSeverity) result = result.filter((f) => f.severity === findingsSeverity);
    if (findingsSearch.trim()) {
      const q = findingsSearch.toLowerCase().trim();
      result = result.filter((f) =>
        f.invoice?.toLowerCase().includes(q) || f.explanation.toLowerCase().includes(q) ||
        f.probableCause.toLowerCase().includes(q) || f.recommendation.toLowerCase().includes(q));
    }
    return result;
  }, [findings, findingsSeverity, findingsSearch]);

  const fmt = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5">Discrepancias y Hallazgos</Typography>

      {/* File selectors */}
      <Paper sx={{ p: 2 }}>
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id="session-auto-select-label">Seleccionar sesión (auto-popular archivos)</InputLabel>
          <Select
            labelId="session-auto-select-label"
            value={selectedSessionForAutoPopulate}
            label="Seleccionar sesión (auto-popular archivos)"
            onChange={handleSessionAutoPopulate}
          >
            <MenuItem value="">Sin sesión (selección manual)</MenuItem>
            {sessions.map((s) => (
              <MenuItem key={s.sessionId} value={s.sessionId}>
                {s.sessionName} ({new Date(s.createdAt).toLocaleDateString('es-CO')})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Seleccionar archivos para comparar</Typography>
        {loadingUploads ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {CASCADE_STAGES.map((stage) => {
              const stageUploads = uploads.filter((u) => u.stage === stage);
              return (
                <FormControl key={stage} size="small" sx={{ minWidth: 200 }}>
                  <InputLabel>{STAGE_DISPLAY_NAMES[stage]}</InputLabel>
                  <Select
                    value={selectedUploads[stage]}
                    label={STAGE_DISPLAY_NAMES[stage]}
                    onChange={(e) => setSelectedUploads((prev) => ({ ...prev, [stage]: e.target.value }))}
                  >
                    <MenuItem value="">— Seleccionar —</MenuItem>
                    {stageUploads.map((u) => (
                      <MenuItem key={u.uploadId} value={u.uploadId}>
                        {u.fileName} ({new Date(u.uploadedAt).toLocaleDateString('es-CO')})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              );
            })}
            <Button
              variant="contained"
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <CompareArrowsIcon />}
              onClick={handleCompareClick}
              disabled={!canCompare || loading}
            >
              {loading ? 'Comparando...' : 'Comparar'}
            </Button>
          </Box>
        )}
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Summary chips */}
      {summary && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip label={`Ref: ${summary.totalRef}`} color="primary" />
          <Chip label={`Coinciden: ${summary.totalMatched}`} color="success" />
          <Chip label={`Con discrepancias: ${summary.totalWithDiscrepancies}`} color="warning" />
          <Chip label={`Faltantes: ${summary.totalMissing}`} color="error" />
          <Chip label={`Dif. monto: ${summary.totalDifferences}`} color="warning" variant="outlined" />
          {summary.totalNegatives > 0 && <Chip label={`Negativos: ${summary.totalNegatives}`} color="error" variant="outlined" />}
          <Chip label={`Dif. total: $${fmt(summary.totalDiffAmount)}`} />
        </Box>
      )}

      {/* Tabs */}
      {discrepancies.length > 0 && (
        <Paper sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
            <Tab label={`Discrepancias (${discrepancies.length})`} />
            <Tab label={`Hallazgos IA (${findings.length})`} icon={<AutoFixHighIcon />} iconPosition="start" />
          </Tabs>
        </Paper>
      )}

      {/* Tab 0: Discrepancias */}
      {tabIndex === 0 && discrepancies.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Buscar factura..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> } }}
              sx={{ minWidth: 250 }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Tipo</InputLabel>
              <Select value={typeFilter} label="Tipo" onChange={(e) => setTypeFilter(e.target.value as DiscrepancyType | '')}>
                <MenuItem value="">Todos</MenuItem>
                <MenuItem value="missing">Factura faltante</MenuItem>
                <MenuItem value="total_diff">Diferencia de monto</MenuItem>
                <MenuItem value="negative_total">Total negativo</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              {filtered.length} de {discrepancies.length} discrepancias
            </Typography>
          </Box>
          <TableContainer sx={{ maxHeight: 600 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Factura</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Tipo</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Etapa</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Total Ref</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Total Etapa</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Diferencia</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Presencia</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((d, i) => (
                  <TableRow key={`${d.invoice}-${d.stage}-${d.type}-${i}`}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{d.invoice}</TableCell>
                    <TableCell>
                      <Chip label={TYPE_LABELS[d.type]} size="small" color={TYPE_COLORS[d.type]} />
                    </TableCell>
                    <TableCell>{STAGE_DISPLAY_NAMES[d.stage]}</TableCell>
                    <TableCell align="right">${fmt(d.refTotal)}</TableCell>
                    <TableCell align="right">{d.stageTotal !== null ? `$${fmt(d.stageTotal)}` : '—'}</TableCell>
                    <TableCell align="right" sx={{ color: d.difference !== 0 ? 'error.main' : 'inherit' }}>
                      {d.difference !== 0 ? `$${fmt(Math.abs(d.difference))}` : '—'}
                    </TableCell>
                    <TableCell>
                      {CASCADE_STAGES.map((s) => (
                        <Chip
                          key={s}
                          label={STAGE_DISPLAY_NAMES[s].slice(0, 3)}
                          size="small"
                          color={d.presence[s] ? 'success' : 'error'}
                          variant="outlined"
                          sx={{ mr: 0.5, fontSize: '0.65rem', height: 20 }}
                        />
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Tab 1: Hallazgos IA */}
      {tabIndex === 1 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              variant="contained"
              startIcon={generatingFindings ? <CircularProgress size={20} color="inherit" /> : <AutoFixHighIcon />}
              onClick={handleGenerateFindings}
              disabled={generatingFindings || discrepancies.length === 0}
            >
              {generatingFindings ? 'Analizando con IA...' : 'Generar Hallazgos con IA'}
            </Button>
            {findings.length > 0 && (
              <Button variant="outlined" color="error" onClick={() => { setFindings([]); setFindingsSuccess(''); }}>
                Limpiar
              </Button>
            )}
          </Box>

          {generatingFindings && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress variant="determinate" value={findingsProgress} />
              <Typography variant="caption" color="text.secondary">
                Procesando con Nova Premier... {findingsProgress}%
              </Typography>
            </Box>
          )}

          {findingsError && <Alert severity="error" sx={{ mb: 2 }}>{findingsError}</Alert>}
          {findingsSuccess && <Alert severity="success" sx={{ mb: 2 }}>{findingsSuccess}</Alert>}

          {findings.length > 0 && (
            <>
              <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <TextField
                  size="small"
                  placeholder="Buscar en hallazgos..."
                  value={findingsSearch}
                  onChange={(e) => setFindingsSearch(e.target.value)}
                  slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> } }}
                  sx={{ minWidth: 250 }}
                />
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Severidad</InputLabel>
                  <Select value={findingsSeverity} label="Severidad" onChange={(e) => setFindingsSeverity(e.target.value)}>
                    <MenuItem value="">Todas</MenuItem>
                    <MenuItem value="critical">Crítico</MenuItem>
                    <MenuItem value="high">Alto</MenuItem>
                    <MenuItem value="medium">Medio</MenuItem>
                    <MenuItem value="low">Bajo</MenuItem>
                  </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary">
                  {filteredFindings.length} de {findings.length} hallazgos
                </Typography>
              </Box>
              <TableContainer sx={{ maxHeight: 600 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Factura</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Severidad</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Explicación</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Causa Probable</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Recomendación</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredFindings.map((f, i) => (
                      <TableRow key={`${f.discrepancyId}-${i}`}>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{f.invoice}</TableCell>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}

          {findings.length === 0 && !generatingFindings && !findingsError && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              Haz clic en "Generar Hallazgos con IA" para analizar las discrepancias con Nova Premier.
            </Typography>
          )}
        </Paper>
      )}

      {discrepancies.length === 0 && !loading && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            Selecciona los archivos de cada etapa y haz clic en "Comparar" para detectar discrepancias.
          </Typography>
        </Paper>
      )}

      {/* Session name dialog */}
      <Dialog open={sessionDialogOpen} onClose={handleSessionDialogCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Nombre de la sesión</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Ingresa un nombre descriptivo para esta sesión de trabajo.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="Nombre de sesión"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && sessionName.trim()) handleSessionDialogConfirm(); }}
            placeholder="Ej: Reconciliación Enero 2025"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSessionDialogCancel}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleSessionDialogConfirm}
            disabled={!sessionName.trim()}
          >
            Crear y Comparar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
