/**
 * RemediationPage — Genera correcciones a partir de hallazgos,
 * permite aprobar/rechazar y descargar XML de corrección.
 *
 * Tres pestañas: Hallazgos → Correcciones → XML Generados
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Tooltip,
  Paper,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import DownloadIcon from '@mui/icons-material/Download';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { useAuth } from '../../hooks/useAuth';
import { RemediationService } from '../../services/remediation';
import { XmlGeneratorService } from '../../services/xml-generator';
import { sessionService } from '../../services/session';
import type { Correction, CorrectionStatus } from '../../types/remediation';

const client = generateClient<Schema>();

interface FindingRecord {
  findingId: string;
  discrepancyId: string;
  explanation: string;
  probableCause: string;
  recommendation: string;
  severity: string;
  analyzedAt: string;
}

const STATUS_LABELS: Record<CorrectionStatus, string> = {
  pending_approval: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

const STATUS_COLORS: Record<CorrectionStatus, 'warning' | 'success' | 'error'> = {
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'error',
};

/** Genera valores corregidos automáticos a partir de un finding. */
function buildCorrectedValues(finding: FindingRecord): Record<string, unknown> {
  if (finding.explanation.includes('total')) {
    return { action: 'recalculate_total', source: 'origin_stage' };
  }
  if (finding.explanation.includes('faltante') || finding.explanation.includes('ausente')) {
    return { action: 'sync_missing_record', source: 'origin_stage' };
  }
  if (finding.explanation.includes('ítems')) {
    return { action: 'reconcile_items', source: 'origin_stage' };
  }
  return { action: 'manual_review', source: 'origin_stage' };
}

export default function RemediationPage() {
  const { user } = useAuth();

  const [tabIndex, setTabIndex] = useState(0);
  const [findings, setFindings] = useState<FindingRecord[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Dialogs
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedCorrection, setSelectedCorrection] = useState<Correction | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [findingsRes, correctionsRes] = await Promise.all([
        client.models.Finding.list({ limit: 1000 }),
        RemediationService.getInstance().getCorrections(),
      ]);
      setFindings((findingsRes.data ?? []).map((f) => ({
        findingId: f.findingId,
        discrepancyId: f.discrepancyId,
        explanation: f.explanation,
        probableCause: f.probableCause,
        recommendation: f.recommendation,
        severity: f.severity ?? 'medium',
        analyzedAt: f.analyzedAt,
      })));
      setCorrections(correctionsRes.items);
    } catch {
      setError('Error al cargar datos de remediación.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Fetch the active session (most recent in_progress) on mount
  useEffect(() => {
    const fetchActiveSession = async () => {
      try {
        const result = await sessionService.listSessions({ status: 'in_progress' });
        if (result.items.length > 0) {
          setActiveSessionId(result.items[0].sessionId);
        }
      } catch (err) {
        console.error('Error al obtener sesión activa:', err);
      }
    };
    fetchActiveSession();
  }, []);

  /** Genera correcciones automáticas para findings sin corrección existente. */
  const handleGenerateCorrections = useCallback(async () => {
    setGenerating(true);
    setActionMsg(null);
    try {
      const existingFindingIds = new Set(corrections.map((c) => c.findingId));
      const newFindings = findings.filter((f) => !existingFindingIds.has(f.findingId));

      if (newFindings.length === 0) {
        setActionMsg({ type: 'success', text: 'Todas las correcciones ya fueron generadas.' });
        setGenerating(false);
        return;
      }

      const service = RemediationService.getInstance();
      let created = 0;
      for (const finding of newFindings) {
        await service.proposeCorrection({
          discrepancyId: finding.discrepancyId,
          findingId: finding.findingId,
          invoice: finding.discrepancyId.slice(0, 8),
          originStage: 'geopos_local',
          correctedValues: buildCorrectedValues(finding),
          proposedBy: user?.email ?? 'system',
          ...(activeSessionId ? { sessionId: activeSessionId } : {}),
        });
        created++;
      }
      setActionMsg({ type: 'success', text: `Se generaron ${created} correcciones.` });
      await loadData();
    } catch {
      setActionMsg({ type: 'error', text: 'Error al generar correcciones.' });
    } finally {
      setGenerating(false);
    }
  }, [findings, corrections, user, loadData, activeSessionId]);

  const handleApprove = async (correction: Correction) => {
    try {
      const service = RemediationService.getInstance();
      await service.approveCorrection(correction.correctionId, user?.email ?? 'admin');
      setActionMsg({ type: 'success', text: 'Corrección aprobada.' });
      await loadData();
    } catch {
      setActionMsg({ type: 'error', text: 'Error al aprobar.' });
    }
  };

  const handleReject = async () => {
    if (!selectedCorrection || !rejectReason.trim()) return;
    try {
      const service = RemediationService.getInstance();
      await service.rejectCorrection(selectedCorrection.correctionId, user?.email ?? 'admin', rejectReason.trim());
      setActionMsg({ type: 'success', text: 'Corrección rechazada.' });
      setRejectOpen(false);
      setRejectReason('');
      setSelectedCorrection(null);
      await loadData();
    } catch {
      setActionMsg({ type: 'error', text: 'Error al rechazar.' });
    }
  };

  const handleDownloadXml = (correction: Correction) => {
    const xmlService = new XmlGeneratorService();
    const xml = xmlService.generateCorrectionXml(correction);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `correction-${correction.correctionId.slice(0, 8)}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const approvedCorrections = corrections.filter((c) => c.status === 'approved');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5">Remediación</Typography>

      {actionMsg && (
        <Alert severity={actionMsg.type} onClose={() => setActionMsg(null)}>
          {actionMsg.text}
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            Genera correcciones automáticas a partir de los hallazgos detectados.
          </Typography>
          <Button
            variant="contained"
            startIcon={generating ? <CircularProgress size={20} color="inherit" /> : <AutoFixHighIcon />}
            onClick={handleGenerateCorrections}
            disabled={generating || findings.length === 0}
          >
            {generating ? 'Generando...' : 'Generar Correcciones'}
          </Button>
          <Chip label={`${findings.length} hallazgos`} size="small" />
          <Chip label={`${corrections.length} correcciones`} size="small" color="primary" />
        </Box>
      </Paper>

      <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} aria-label="Pestañas de remediación">
        <Tab label={`Hallazgos (${findings.length})`} />
        <Tab label={`Correcciones (${corrections.length})`} />
        <Tab label={`XML Generados (${approvedCorrections.length})`} />
      </Tabs>

      {/* Tab 0: Hallazgos */}
      {tabIndex === 0 && (
        findings.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No hay hallazgos. Genera hallazgos primero desde la página de Hallazgos.</Typography>
          </Paper>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {findings.map((f) => (
              <Card key={f.findingId} variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2" fontFamily="monospace">{f.findingId.slice(0, 8)}…</Typography>
                    <Chip label={f.severity} size="small" color={f.severity === 'high' || f.severity === 'critical' ? 'error' : 'warning'} />
                  </Box>
                  <Typography variant="body2" gutterBottom>{f.explanation}</Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>Causa: {f.probableCause}</Typography>
                  <Typography variant="body2" color="text.secondary">Recomendación: {f.recommendation}</Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        )
      )}

      {/* Tab 1: Correcciones */}
      {tabIndex === 1 && (
        corrections.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No hay correcciones. Haz clic en "Generar Correcciones".</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Propuesto por</TableCell>
                  <TableCell>Acción</TableCell>
                  <TableCell>Fecha</TableCell>
                  <TableCell align="center">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {corrections.map((c) => (
                  <TableRow key={c.correctionId}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{c.correctionId.slice(0, 8)}…</TableCell>
                    <TableCell><Chip label={STATUS_LABELS[c.status]} size="small" color={STATUS_COLORS[c.status]} /></TableCell>
                    <TableCell>{c.proposedBy}</TableCell>
                    <TableCell>{(c.correctedValues as Record<string, unknown>)?.action as string ?? '—'}</TableCell>
                    <TableCell>{new Date(c.proposedAt).toLocaleDateString('es-CO')}</TableCell>
                    <TableCell align="center">
                        {c.status === 'pending_approval' && (
                          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                            <Tooltip title="Aprobar"><IconButton color="success" size="small" onClick={() => handleApprove(c)}><CheckCircleIcon /></IconButton></Tooltip>
                            <Tooltip title="Rechazar"><IconButton color="error" size="small" onClick={() => { setSelectedCorrection(c); setRejectOpen(true); }}><CancelIcon /></IconButton></Tooltip>
                          </Box>
                        )}
                        {c.status === 'rejected' && c.rejectionReason && (
                          <Typography variant="caption" color="error">Motivo: {c.rejectionReason}</Typography>
                        )}
                        {c.status === 'approved' && (
                          <Chip label="Aprobada" size="small" color="success" />
                        )}
                      </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Tab 2: XML Generados */}
      {tabIndex === 2 && (
        approvedCorrections.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No hay correcciones aprobadas. Aprueba correcciones para generar XML.</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID Corrección</TableCell>
                  <TableCell>Acción</TableCell>
                  <TableCell>Aprobado por</TableCell>
                  <TableCell>Fecha</TableCell>
                  <TableCell align="center">Descargar XML</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {approvedCorrections.map((c) => (
                  <TableRow key={c.correctionId}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{c.correctionId.slice(0, 8)}…</TableCell>
                    <TableCell>{(c.correctedValues as Record<string, unknown>)?.action as string ?? '—'}</TableCell>
                    <TableCell>{c.approvedBy ?? '—'}</TableCell>
                    <TableCell>{c.reviewedAt ? new Date(c.reviewedAt).toLocaleDateString('es-CO') : '—'}</TableCell>
                    <TableCell align="center">
                      <Tooltip title="Descargar XML">
                        <IconButton color="primary" onClick={() => handleDownloadXml(c)}><DownloadIcon /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Diálogo: Rechazar corrección */}
      <Dialog open={rejectOpen} onClose={() => { setRejectOpen(false); setRejectReason(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>Rechazar corrección</DialogTitle>
        <DialogContent>
          {selectedCorrection && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Corrección: {selectedCorrection.correctionId.slice(0, 8)}…
            </Typography>
          )}
          <TextField
            label="Motivo de rechazo"
            fullWidth
            margin="normal"
            multiline
            minRows={2}
            required
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setRejectOpen(false); setRejectReason(''); }}>Cancelar</Button>
          <Button variant="contained" color="error" onClick={handleReject} disabled={!rejectReason.trim()}>Rechazar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
