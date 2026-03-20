/**
 * DashboardPage — Página principal del dashboard de reconciliación.
 *
 * Muestra métricas consolidadas: resumen de plataforma, reconciliación,
 * discrepancias por etapa, resultados de calidad y estado de remediación.
 * Todo el texto UI está en español.
 */
import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  alpha,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PercentIcon from '@mui/icons-material/Percent';
import BuildIcon from '@mui/icons-material/Build';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import LayersIcon from '@mui/icons-material/Layers';
import { DashboardService } from '../../services/dashboard';
import type { DashboardData, StageDiscrepancies, PlatformSummary } from '../../types/dashboard';
import type { DiscrepancyType } from '../../types/comparison';

/** Etiquetas legibles para las etapas de la cascada. */
const STAGE_LABELS: Record<string, string> = {
  geopos_local: 'Geopos Local',
  geopos_central: 'Geopos Central',
  integracion: 'Integración',
  ps_ck_intfc_vtapos: 'PS CK',
  'geopos-local': 'Geopos Local',
  'geopos-central': 'Geopos Central',
  'ps-ck': 'PS CK',
};

/** Etiquetas legibles para tipos de discrepancia. */
const DISCREPANCY_TYPE_LABELS: Record<DiscrepancyType, string> = {
  missing_invoice: 'Factura perdida',
  total_difference: 'Diferencia de total',
  item_count_difference: 'Diferencia de ítems',
  missing_item: 'Ítem perdido',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const service = DashboardService.getInstance();
    service
      .getDashboardData(0)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        console.error('Error al cargar datos del dashboard:', err);
        setError('No se pudieron cargar los datos del dashboard.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, gap: 2 }}
        role="status"
        aria-label="Cargando dashboard"
      >
        <CircularProgress />
        <Typography color="text.secondary">Cargando datos del dashboard…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!data) return null;

  const { reconciliation, stageDiscrepancies, quality, remediation, platform } = data;

  const hasDiscrepancies = reconciliation.invoicesWithDiscrepancies > 0;
  const hasQuality = quality.totalRules > 0;
  const hasRemediation = remediation.proposed > 0;
  const hasStageDiscrepancies = stageDiscrepancies.some((s) => s.count > 0);

  return (
    <Box sx={{ py: 2 }} role="region" aria-label="Dashboard de reconciliación">
      <Typography variant="h4" component="h1" gutterBottom>
        Dashboard
      </Typography>

      {/* Resumen de plataforma */}
      <PlatformCards platform={platform} />

      {/* Tarjetas de reconciliación — solo si hay facturas */}
      {reconciliation.totalInvoices > 0 && (
        <>
          <Typography variant="h6" gutterBottom sx={{ mt: 1 }}>
            Reconciliación
          </Typography>
          <ReconciliationCards
            totalInvoices={reconciliation.totalInvoices}
            invoicesWithDiscrepancies={reconciliation.invoicesWithDiscrepancies}
            discrepancyRate={reconciliation.discrepancyRate}
            remediationApproved={remediation.approved}
            remediationPending={remediation.pendingApproval}
          />
        </>
      )}

      {/* Discrepancias por tipo — solo si hay discrepancias */}
      {hasDiscrepancies && (
        <DiscrepancyTypeCards countByType={reconciliation.countByType} />
      )}

      {/* Discrepancias por etapa — solo si hay al menos una */}
      {hasStageDiscrepancies && (
        <StageDiscrepanciesSection stages={stageDiscrepancies.filter((s) => s.count > 0)} />
      )}

      {/* Resultados de calidad — solo si hay reglas ejecutadas */}
      {hasQuality && (
        <QualityResultsSection
          totalRules={quality.totalRules}
          passed={quality.passed}
          failed={quality.failed}
          byDataset={quality.byDataset}
        />
      )}

      {/* Estado de remediación — solo si hay correcciones */}
      {hasRemediation && (
        <RemediationStatusSection remediation={remediation} />
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat card reutilizable con icono y color de fondo                 */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2.5 }}>
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(color, 0.12),
            color,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography variant="h5" fontWeight={700} noWrap>
            {typeof value === 'number' ? value.toLocaleString('es-CO') : value}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tarjetas de plataforma (uploads y sesiones)                       */
/* ------------------------------------------------------------------ */

function PlatformCards({ platform }: { platform: PlatformSummary }) {
  const stageEntries = Object.entries(platform.uploadsByStage);

  return (
    <Box sx={{ mb: 4 }}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Total Archivos Subidos"
            value={platform.totalUploads}
            icon={<CloudUploadIcon fontSize="medium" />}
            color="#0055b8"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Total Sesiones"
            value={platform.totalSessions}
            icon={<FolderOpenIcon fontSize="medium" />}
            color="#001689"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Sesiones En Progreso"
            value={platform.sessionsInProgress}
            icon={<HourglassTopIcon fontSize="medium" />}
            color="#ffb548"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Sesiones Completadas"
            value={platform.sessionsCompleted}
            icon={<TaskAltIcon fontSize="medium" />}
            color="#00c387"
          />
        </Grid>
      </Grid>

      {/* Archivos por etapa */}
      {stageEntries.length > 0 && (
        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <LayersIcon color="primary" />
              <Typography variant="subtitle1" fontWeight={600}>
                Archivos por Etapa
              </Typography>
            </Box>
            <Grid container spacing={2}>
              {stageEntries.map(([stage, count]) => (
                <Grid key={stage} size={{ xs: 6, sm: 3 }}>
                  <Box
                    sx={{
                      textAlign: 'center',
                      p: 1.5,
                      borderRadius: 2,
                      bgcolor: 'background.default',
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {stageLabel(stage)}
                    </Typography>
                    <Typography variant="h6" fontWeight={700} color="primary.main">
                      {count}
                    </Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Tarjetas de reconciliación                                        */
/* ------------------------------------------------------------------ */

interface ReconciliationCardsProps {
  totalInvoices: number;
  invoicesWithDiscrepancies: number;
  discrepancyRate: number;
  remediationApproved: number;
  remediationPending: number;
}

function ReconciliationCards({
  totalInvoices,
  invoicesWithDiscrepancies,
  discrepancyRate,
  remediationApproved,
  remediationPending,
}: ReconciliationCardsProps) {
  return (
    <Grid container spacing={2} sx={{ mb: 4 }}>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="Total Facturas"
          value={totalInvoices}
          icon={<ReceiptLongIcon fontSize="medium" />}
          color="#001689"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="Con Discrepancias"
          value={invoicesWithDiscrepancies}
          icon={<WarningAmberIcon fontSize="medium" />}
          color="#ffb548"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="Tasa de Discrepancia"
          value={`${(discrepancyRate * 100).toFixed(1)}%`}
          icon={<PercentIcon fontSize="medium" />}
          color="rgb(253, 74, 92)"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="Remediación"
          value={`${remediationApproved} / ${remediationPending} pend.`}
          icon={<BuildIcon fontSize="medium" />}
          color="#2ed9c3"
        />
      </Grid>
    </Grid>
  );
}

/* ------------------------------------------------------------------ */
/*  Tarjetas de discrepancias por tipo                                */
/* ------------------------------------------------------------------ */

function DiscrepancyTypeCards({
  countByType,
}: {
  countByType: Record<DiscrepancyType, number>;
}) {
  const types = Object.entries(countByType) as [DiscrepancyType, number][];

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Discrepancias por Tipo
      </Typography>
      <Grid container spacing={2}>
        {types.map(([type, count]) => (
          <Grid key={type} size={{ xs: 6, sm: 3 }}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {DISCREPANCY_TYPE_LABELS[type]}
                </Typography>
                <Typography variant="h5" fontWeight={600}>
                  {count}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Discrepancias agrupadas por par de etapas                         */
/* ------------------------------------------------------------------ */

function StageDiscrepanciesSection({ stages }: { stages: StageDiscrepancies[] }) {
  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Discrepancias por Etapa
      </Typography>
      {stages.length === 0 ? (
        <Typography color="text.secondary">No hay discrepancias registradas.</Typography>
      ) : (
        <Grid container spacing={2}>
          {stages.map((s) => {
            const key = `${s.stagePair.source}-${s.stagePair.target}`;
            return (
              <Grid key={key} size={{ xs: 12, md: 4 }}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      {stageLabel(s.stagePair.source)} → {stageLabel(s.stagePair.target)}
                    </Typography>
                    <Typography variant="h4" fontWeight={700} color="primary.main">
                      {s.count}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      discrepancias
                    </Typography>

                    {s.discrepancies.length > 0 && (
                      <TableContainer sx={{ mt: 2, maxHeight: 200 }}>
                        <Table size="small" aria-label={`Discrepancias ${stageLabel(s.stagePair.source)} a ${stageLabel(s.stagePair.target)}`}>
                          <TableHead>
                            <TableRow>
                              <TableCell>Factura</TableCell>
                              <TableCell>Tipo</TableCell>
                              <TableCell>Detalle</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {s.discrepancies.slice(0, 5).map((d) => (
                              <TableRow key={d.discrepancyId}>
                                <TableCell>{d.invoice}</TableCell>
                                <TableCell>
                                  <Chip
                                    label={DISCREPANCY_TYPE_LABELS[d.type]}
                                    size="small"
                                    color={d.type === 'missing_invoice' || d.type === 'missing_item' ? 'error' : 'warning'}
                                  />
                                </TableCell>
                                <TableCell sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {d.details.message}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Resultados de calidad por dataset                                 */
/* ------------------------------------------------------------------ */

interface QualityResultsProps {
  totalRules: number;
  passed: number;
  failed: number;
  byDataset: { uploadId: string; stage: string; totalRules: number; passed: number; failed: number }[];
}

function QualityResultsSection({ totalRules, passed, failed, byDataset }: QualityResultsProps) {
  const passRate = totalRules > 0 ? (passed / totalRules) * 100 : 0;

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Resultados de Calidad
      </Typography>
      <Card variant="outlined">
        <CardContent>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 4 }}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">Total Reglas</Typography>
                <Typography variant="h5" fontWeight={600}>{totalRules}</Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 4 }}>
              <Box sx={{ textAlign: 'center' }}>
                <CheckCircleIcon sx={{ color: 'success.main' }} />
                <Typography variant="body2" color="text.secondary">Pasaron</Typography>
                <Typography variant="h5" fontWeight={600} color="success.main">{passed}</Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 4 }}>
              <Box sx={{ textAlign: 'center' }}>
                <CancelIcon sx={{ color: 'error.main' }} />
                <Typography variant="body2" color="text.secondary">Fallaron</Typography>
                <Typography variant="h5" fontWeight={600} color="error.main">{failed}</Typography>
              </Box>
            </Grid>
          </Grid>

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Tasa de aprobación: {passRate.toFixed(1)}%
            </Typography>
            <LinearProgress
              variant="determinate"
              value={passRate}
              color={passRate >= 80 ? 'success' : passRate >= 50 ? 'warning' : 'error'}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>

          {byDataset.length > 0 && (
            <TableContainer>
              <Table size="small" aria-label="Resultados de calidad por dataset">
                <TableHead>
                  <TableRow>
                    <TableCell>Dataset</TableCell>
                    <TableCell>Etapa</TableCell>
                    <TableCell align="right">Reglas</TableCell>
                    <TableCell align="right">Pasaron</TableCell>
                    <TableCell align="right">Fallaron</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {byDataset.map((ds) => (
                    <TableRow key={ds.uploadId}>
                      <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ds.uploadId}
                      </TableCell>
                      <TableCell>{stageLabel(ds.stage)}</TableCell>
                      <TableCell align="right">{ds.totalRules}</TableCell>
                      <TableCell align="right">
                        <Chip label={ds.passed} size="small" color="success" variant="outlined" />
                      </TableCell>
                      <TableCell align="right">
                        <Chip label={ds.failed} size="small" color="error" variant="outlined" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Estado de remediación                                             */
/* ------------------------------------------------------------------ */

function RemediationStatusSection({
  remediation,
}: {
  remediation: { proposed: number; pendingApproval: number; approved: number; rejected: number; xmlGenerated: number };
}) {
  const items = [
    { label: 'Propuestas', value: remediation.proposed, color: 'primary' as const },
    { label: 'Pendientes', value: remediation.pendingApproval, color: 'warning' as const },
    { label: 'Aprobadas', value: remediation.approved, color: 'success' as const },
    { label: 'Rechazadas', value: remediation.rejected, color: 'error' as const },
    { label: 'XML Generados', value: remediation.xmlGenerated, color: 'info' as const },
  ];

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Estado de Remediación
      </Typography>
      <Grid container spacing={2}>
        {items.map((item) => (
          <Grid key={item.label} size={{ xs: 6, sm: 4, md: 2.4 }}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {item.label}
                </Typography>
                <Typography variant="h5" fontWeight={600} color={`${item.color}.main`}>
                  {item.value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
