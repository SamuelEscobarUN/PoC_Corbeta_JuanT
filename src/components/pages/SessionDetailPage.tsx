/**
 * SessionDetailPage — Detalle de una sesión de trabajo.
 *
 * Muestra información general, archivos, discrepancias, hallazgos IA
 * y correcciones en pestañas separadas. Permite cambiar el estado de
 * la sesión según las transiciones válidas.
 *
 * Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArchiveIcon from '@mui/icons-material/Archive';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionService } from '../../services/session';
import { uploadService } from '../../services/upload';
import { STAGE_DISPLAY_NAMES } from '../organisms/FileUploadForm';
import type { Session, SessionStatus } from '../../types/session';
import type { UploadRecord } from '../../types/upload';
import type { Discrepancy } from '../../types/comparison';
import type { Finding } from '../../types/ai-analysis';
import type { Correction, CorrectionStatus } from '../../types/remediation';
import type { CascadeStage } from '../../types/csv';

const STATUS_LABELS: Record<SessionStatus, string> = {
  in_progress: 'En progreso',
  completed: 'Completada',
  archived: 'Archivada',
};

const STATUS_COLORS: Record<SessionStatus, 'warning' | 'success' | 'default'> = {
  in_progress: 'warning',
  completed: 'success',
  archived: 'default',
};

const DISCREPANCY_TYPE_LABELS: Record<string, string> = {
  missing_invoice: 'Factura faltante',
  total_difference: 'Diferencia de monto',
  item_count_difference: 'Diferencia de ítems',
  missing_item: 'Ítem faltante',
};

const DISCREPANCY_TYPE_COLORS: Record<string, 'error' | 'warning' | 'info'> = {
  missing_invoice: 'error',
  total_difference: 'warning',
  item_count_difference: 'warning',
  missing_item: 'error',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
};

const SEVERITY_COLORS: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
};

const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  pending_approval: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

const CORRECTION_STATUS_COLORS: Record<CorrectionStatus, 'warning' | 'success' | 'error'> = {
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'error',
};

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);

  const [loading, setLoading] = useState(true);
  const [tabIndex, setTabIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);

  const isArchived = session?.status === 'archived';

  const loadSession = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await sessionService.getSession(id);
      if (!data) {
        setError('Sesión no encontrada.');
        setLoading(false);
        return;
      }
      setSession(data);
    } catch {
      setError('Error al cargar la sesión.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  /** Load uploads for the "Archivos" tab. */
  const loadUploads = useCallback(async () => {
    if (!session?.uploadIds?.length) return;
    try {
      const { items } = await uploadService.getUploadHistory(undefined, null, 200);
      const sessionUploads = items.filter((u) =>
        session.uploadIds.includes(u.uploadId),
      );
      setUploads(sessionUploads);
    } catch {
      // Non-blocking: uploads tab will show empty
    }
  }, [session?.uploadIds]);

  /** Load discrepancies for the "Discrepancias" tab. */
  const loadDiscrepancies = useCallback(async () => {
    if (!id) return;
    try {
      const data = await sessionService.getSessionDiscrepancies(id);
      setDiscrepancies(data);
    } catch {
      // Non-blocking
    }
  }, [id]);

  /** Load findings for the "Hallazgos IA" tab. */
  const loadFindings = useCallback(async () => {
    if (!id) return;
    try {
      const data = await sessionService.getSessionFindings(id);
      setFindings(data);
    } catch {
      // Non-blocking
    }
  }, [id]);

  /** Load corrections for the "Correcciones" tab. */
  const loadCorrections = useCallback(async () => {
    if (!id) return;
    try {
      const data = await sessionService.getSessionCorrections(id);
      setCorrections(data);
    } catch {
      // Non-blocking
    }
  }, [id]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Load tab-specific data when session is available
  useEffect(() => {
    if (!session) return;
    loadUploads();
    loadDiscrepancies();
    loadFindings();
    loadCorrections();
  }, [session, loadUploads, loadDiscrepancies, loadFindings, loadCorrections]);

  const handleStatusChange = async (newStatus: SessionStatus) => {
    if (!id) return;
    setStatusChanging(true);
    setActionMsg(null);
    try {
      const updated = await sessionService.updateSessionStatus(id, newStatus);
      setSession(updated);
      setActionMsg({
        type: 'success',
        text: newStatus === 'completed'
          ? 'Sesión marcada como completada.'
          : 'Sesión archivada exitosamente.',
      });
    } catch (err) {
      setActionMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al cambiar el estado.',
      });
    } finally {
      setStatusChanging(false);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !session) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Alert severity="error">{error ?? 'Sesión no encontrada.'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/sessions')}>
          Volver a Sesiones
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/sessions')} size="small">
          Sesiones
        </Button>
        <Typography variant="h5" sx={{ flex: 1 }}>{session.sessionName}</Typography>
        <Chip
          label={STATUS_LABELS[session.status]}
          color={STATUS_COLORS[session.status]}
        />
      </Box>

      {actionMsg && (
        <Alert severity={actionMsg.type} onClose={() => setActionMsg(null)}>
          {actionMsg.text}
        </Alert>
      )}

      {isArchived && (
        <Alert severity="info">Esta sesión está archivada y es de solo lectura.</Alert>
      )}

      {/* Tabs */}
      <Paper sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} aria-label="Pestañas de detalle de sesión">
          <Tab label="Información General" />
          <Tab label={`Archivos (${uploads.length})`} />
          <Tab label={`Discrepancias (${discrepancies.length})`} />
          <Tab label={`Hallazgos IA (${findings.length})`} />
          <Tab label={`Correcciones (${corrections.length})`} />
        </Tabs>
      </Paper>

      {/* Tab 0: Información General */}
      {tabIndex === 0 && (
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Nombre</Typography>
                <Typography variant="body1">{session.sessionName}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Fecha de Creación</Typography>
                <Typography variant="body1">
                  {new Date(session.createdAt).toLocaleDateString('es-CO', {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Estado</Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Chip label={STATUS_LABELS[session.status]} color={STATUS_COLORS[session.status]} size="small" />
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Usuario</Typography>
                <Typography variant="body1">{session.createdBy}</Typography>
              </Box>
              {session.completedAt && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Fecha de Finalización</Typography>
                  <Typography variant="body1">
                    {new Date(session.completedAt).toLocaleDateString('es-CO', {
                      year: 'numeric', month: 'long', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip label={`${discrepancies.length} discrepancias`} size="small" variant="outlined" />
              <Chip label={`${findings.length} hallazgos`} size="small" variant="outlined" />
              <Chip label={`${corrections.length} correcciones`} size="small" variant="outlined" />
            </Box>

            {/* Status change buttons */}
            {!isArchived && (
              <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                {session.status === 'in_progress' && (
                  <Button
                    variant="contained"
                    color="success"
                    startIcon={statusChanging ? <CircularProgress size={20} color="inherit" /> : <CheckCircleIcon />}
                    onClick={() => handleStatusChange('completed')}
                    disabled={statusChanging}
                  >
                    Completar Sesión
                  </Button>
                )}
                {session.status === 'completed' && (
                  <Button
                    variant="outlined"
                    startIcon={statusChanging ? <CircularProgress size={20} color="inherit" /> : <ArchiveIcon />}
                    onClick={() => handleStatusChange('archived')}
                    disabled={statusChanging}
                  >
                    Archivar Sesión
                  </Button>
                )}
              </Box>
            )}
          </Box>
        </Paper>
      )}

      {/* Tab 1: Archivos */}
      {tabIndex === 1 && (
        uploads.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No se encontraron archivos asociados a esta sesión.</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Nombre</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Etapa</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Fecha de Carga</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {uploads.map((u) => (
                  <TableRow key={u.uploadId}>
                    <TableCell>{u.fileName}</TableCell>
                    <TableCell>{STAGE_DISPLAY_NAMES[u.stage] ?? u.stage}</TableCell>
                    <TableCell>
                      {new Date(u.uploadedAt).toLocaleDateString('es-CO', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Tab 2: Discrepancias */}
      {tabIndex === 2 && (
        discrepancies.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No hay discrepancias registradas en esta sesión.</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Factura</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Tipo</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Etapa</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Valor Esperado</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Valor Actual</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">Diferencia</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Presencia</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {discrepancies.map((d) => {
                  const expected = parseFloat(d.details.expectedValue ?? '0');
                  const actual = d.details.actualValue && d.details.actualValue !== 'N/A'
                    ? parseFloat(d.details.actualValue)
                    : null;
                  const diff = actual !== null ? expected - actual : expected;

                  return (
                    <TableRow key={d.discrepancyId}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{d.invoice}</TableCell>
                      <TableCell>
                        <Chip
                          label={DISCREPANCY_TYPE_LABELS[d.type] ?? d.type}
                          size="small"
                          color={DISCREPANCY_TYPE_COLORS[d.type] ?? 'default'}
                        />
                      </TableCell>
                      <TableCell>{STAGE_DISPLAY_NAMES[d.targetStage] ?? d.targetStage}</TableCell>
                      <TableCell align="right">${fmt(expected)}</TableCell>
                      <TableCell align="right">{actual !== null ? `$${fmt(actual)}` : '—'}</TableCell>
                      <TableCell align="right" sx={{ color: diff !== 0 ? 'error.main' : 'inherit' }}>
                        {diff !== 0 ? `$${fmt(Math.abs(diff))}` : '—'}
                      </TableCell>
                      <TableCell>
                        {([
                          'geopos_local', 'geopos_central', 'integracion', 'ps_ck_intfc_vtapos',
                        ] as CascadeStage[]).map((s) => (
                          <Chip
                            key={s}
                            label={STAGE_DISPLAY_NAMES[s].slice(0, 3)}
                            size="small"
                            color={s === d.sourceStage || s === d.targetStage ? 'success' : 'default'}
                            variant="outlined"
                            sx={{ mr: 0.5, fontSize: '0.65rem', height: 20 }}
                          />
                        ))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Tab 3: Hallazgos IA */}
      {tabIndex === 3 && (
        findings.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No hay hallazgos IA registrados en esta sesión.</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Severidad</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Explicación</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Causa Probable</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Recomendación</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {findings.map((f) => (
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Tab 4: Correcciones */}
      {tabIndex === 4 && (
        corrections.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No hay correcciones registradas en esta sesión.</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>ID</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Estado</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Acción</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Propuesto por</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Fecha Propuesta</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Fecha Revisión</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {corrections.map((c) => (
                  <TableRow key={c.correctionId}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {c.correctionId.slice(0, 8)}…
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={CORRECTION_STATUS_LABELS[c.status]}
                        size="small"
                        color={CORRECTION_STATUS_COLORS[c.status]}
                      />
                    </TableCell>
                    <TableCell>
                      {(c.correctedValues as Record<string, unknown>)?.action as string ?? '—'}
                    </TableCell>
                    <TableCell>{c.proposedBy}</TableCell>
                    <TableCell>
                      {new Date(c.proposedAt).toLocaleDateString('es-CO')}
                    </TableCell>
                    <TableCell>
                      {c.reviewedAt ? new Date(c.reviewedAt).toLocaleDateString('es-CO') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}
    </Box>
  );
}
