/**
 * QualityRulesPage — Página de gestión de reglas de calidad (solo Administrador).
 *
 * Permite crear, editar, eliminar y listar reglas de calidad por etapa.
 * Ejecuta reglas vía backend (Lambda + Glue Data Quality).
 * Muestra resultados de ejecución y alertas por severidad.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Chip,
  Alert,
  Tabs,
  Tab,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { qualityRulesService } from '../../services/quality-rules';
import { validateDqdlExpression, generateBaseExpression } from '../../services/dqdl-translator';
import { useAuth } from '../../hooks/useAuth';
import type { CascadeStage } from '../../types/csv';
import type {
  QualityRule,
  QualityRuleType,
  QualityExecutionSummary,
  AlertSeverity,
} from '../../types/quality';

/** Etapas disponibles para filtrar reglas. */
const STAGES: { value: CascadeStage; label: string }[] = [
  { value: 'geopos_local', label: 'Geopos Local' },
  { value: 'geopos_central', label: 'Geopos Central' },
  { value: 'integracion', label: 'Integración' },
  { value: 'ps_ck_intfc_vtapos', label: 'PS CK' },
];

/** Tipos de regla disponibles. */
const RULE_TYPES: { value: QualityRuleType; label: string }[] = [
  { value: 'completeness', label: 'Completitud' },
  { value: 'uniqueness', label: 'Unicidad' },
  { value: 'range', label: 'Rango' },
  { value: 'format', label: 'Formato' },
  { value: 'referential', label: 'Referencial' },
  { value: 'custom', label: 'Personalizada' },
];

/** Mapeo de severidad a color de chip. */
const SEVERITY_COLORS: Record<AlertSeverity, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'warning',
  medium: 'warning',
  low: 'info',
};

/** Mapeo de severidad a color de fondo para chips personalizados. */
const SEVERITY_BG_COLORS: Record<AlertSeverity, string> = {
  critical: '#d32f2f',
  high: '#ed6c02',
  medium: '#fbc02d',
  low: '#1976d2',
};

/** Mapeo de severidad a etiqueta en español. */
const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

/** Estado del formulario de regla. */
interface RuleFormState {
  ruleName: string;
  stage: CascadeStage;
  type: QualityRuleType;
  expression: string;
  targetColumn: string;
  threshold: number;
  enabled: boolean;
}

const INITIAL_FORM: RuleFormState = {
  ruleName: '',
  stage: 'geopos_local',
  type: 'completeness',
  expression: '',
  targetColumn: '',
  threshold: 1.0,
  enabled: true,
};

export default function QualityRulesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Administrator');

  const [rules, setRules] = useState<QualityRule[]>([]);
  const [stageFilter, setStageFilter] = useState<CascadeStage | ''>('');
  const [tabIndex, setTabIndex] = useState(0);
  const [loadError, setLoadError] = useState('');

  // Diálogo crear/editar
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<QualityRule | null>(null);
  const [form, setForm] = useState<RuleFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState('');

  // Diálogo eliminar
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRule, setDeletingRule] = useState<QualityRule | null>(null);

  // Ejecución de reglas
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionSummary, setExecutionSummary] = useState<QualityExecutionSummary | null>(null);
  const [executionError, setExecutionError] = useState('');

  // Alerta de permisos insuficientes
  const [permissionAlert, setPermissionAlert] = useState('');

  // Flag para recargar resultados históricos al ejecutar reglas
  const [resultsRefreshKey, setResultsRefreshKey] = useState(0);

  /** Cargar reglas desde el servicio (async). */
  const loadRules = useCallback(async () => {
    try {
      setLoadError('');
      const stage = stageFilter || undefined;
      const loaded = await qualityRulesService.listRules(stage);
      setRules(loaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al cargar reglas. Intente recargar la página.';
      setLoadError(message);
      setRules([]);
    }
  }, [stageFilter]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  /** Determinar si hay reglas activas para la etapa seleccionada. */
  const hasActiveRules = rules.some((r) => r.enabled);

  /* ------------------------------------------------------------------ */
  /*  Handlers de formulario                                            */
  /* ------------------------------------------------------------------ */

  const handleOpenCreate = () => {
    if (!isAdmin) {
      setPermissionAlert('No tiene permisos suficientes para realizar esta operación');
      return;
    }
    setEditingRule(null);
    setForm(INITIAL_FORM);
    setFormError('');
    setDialogOpen(true);
  };

  const handleOpenEdit = (rule: QualityRule) => {
    if (!isAdmin) {
      setPermissionAlert('No tiene permisos suficientes para realizar esta operación');
      return;
    }
    setEditingRule(rule);
    setForm({
      ruleName: rule.ruleName,
      stage: rule.stage,
      type: rule.type,
      expression: rule.expression,
      targetColumn: rule.targetColumn ?? '',
      threshold: rule.threshold,
      enabled: rule.enabled,
    });
    setFormError('');
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingRule(null);
  };

  const handleSave = async () => {
    if (!form.ruleName.trim()) {
      setFormError('El nombre de la regla es obligatorio');
      return;
    }
    if (!form.expression.trim()) {
      setFormError('La expresión es obligatoria');
      return;
    }

    try {
      if (editingRule) {
        await qualityRulesService.updateRule(editingRule.ruleId, {
          ruleName: form.ruleName,
          expression: form.expression,
          targetColumn: form.targetColumn || undefined,
          threshold: form.threshold,
          enabled: form.enabled,
        });
      } else {
        await qualityRulesService.createRule({
          ruleName: form.ruleName,
          stage: form.stage,
          type: form.type,
          expression: form.expression,
          targetColumn: form.targetColumn || undefined,
          threshold: form.threshold,
          enabled: form.enabled,
        });
      }

      handleCloseDialog();
      await loadRules();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al guardar la regla';
      setFormError(message);
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Handlers de eliminación                                           */
  /* ------------------------------------------------------------------ */

  const handleOpenDelete = (rule: QualityRule) => {
    if (!isAdmin) {
      setPermissionAlert('No tiene permisos suficientes para realizar esta operación');
      return;
    }
    setDeletingRule(rule);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (deletingRule) {
      try {
        await qualityRulesService.deleteRule(deletingRule.ruleId);
        await loadRules();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al eliminar la regla';
        setLoadError(message);
      }
    }
    setDeleteDialogOpen(false);
    setDeletingRule(null);
  };

  /* ------------------------------------------------------------------ */
  /*  Handler de ejecución de reglas                                    */
  /* ------------------------------------------------------------------ */

  const handleExecuteRules = async () => {
    const stage = stageFilter || 'geopos_local';
    setIsExecuting(true);
    setExecutionSummary(null);
    setExecutionError('');

    try {
      const summary = await qualityRulesService.executeRules('current-upload', stage as CascadeStage);
      setExecutionSummary(summary);
      setResultsRefreshKey((k) => k + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al ejecutar las reglas de calidad';
      setExecutionError(message);
    } finally {
      setIsExecuting(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Render                                                            */
  /* ------------------------------------------------------------------ */

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} role="region" aria-label="Reglas de calidad">
      <Typography variant="h4" component="h1">Reglas de Calidad</Typography>

      <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} aria-label="Pestañas de reglas de calidad">
        <Tab label="Gestión de Reglas" />
        <Tab label="Resultados de Ejecución" />
      </Tabs>

      {loadError && <Alert severity="error">{loadError}</Alert>}
      {permissionAlert && (
        <Alert severity="warning" onClose={() => setPermissionAlert('')}>
          {permissionAlert}
        </Alert>
      )}

      {tabIndex === 0 && (
        <>
          <RulesManagementTab
            rules={rules}
            stageFilter={stageFilter}
            onStageFilterChange={setStageFilter}
            onOpenCreate={handleOpenCreate}
            onOpenEdit={handleOpenEdit}
            onOpenDelete={handleOpenDelete}
            isAdmin={isAdmin}
          />

          {/* Botón Ejecutar Reglas */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              variant="contained"
              color="secondary"
              startIcon={isExecuting ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
              onClick={handleExecuteRules}
              disabled={!hasActiveRules || isExecuting}
            >
              {isExecuting ? 'Ejecutando reglas de calidad...' : 'Ejecutar Reglas'}
            </Button>
          </Box>

          {/* Error de ejecución */}
          {executionError && (
            <Alert severity="error">{executionError}</Alert>
          )}

          {/* Resumen de ejecución */}
          {executionSummary && (
            <ExecutionSummaryPanel summary={executionSummary} />
          )}
        </>
      )}

      {tabIndex === 1 && (
        <ExecutionResultsTab refreshKey={resultsRefreshKey} />
      )}

      {/* Diálogo crear/editar regla */}
      <RuleFormDialog
        open={dialogOpen}
        editing={!!editingRule}
        form={form}
        formError={formError}
        onFormChange={setForm}
        onSave={handleSave}
        onClose={handleCloseDialog}
      />

      {/* Diálogo confirmar eliminación */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Confirmar Eliminación</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Está seguro de que desea eliminar la regla &quot;{deletingRule?.ruleName}&quot;?
            Esta acción no se puede deshacer.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancelar</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}


/* ------------------------------------------------------------------ */
/*  Sub-componentes                                                   */
/* ------------------------------------------------------------------ */

/** Panel de resumen de ejecución con alertas por severidad. */
function ExecutionSummaryPanel({ summary }: { summary: QualityExecutionSummary }) {
  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h6">Resumen de Ejecución</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Chip label={`Total: ${summary.totalRules}`} />
        <Chip label={`Pasaron: ${summary.passed}`} color="success" />
        <Chip label={`Fallaron: ${summary.failed}`} color={summary.failed > 0 ? 'error' : 'default'} />
      </Box>

      {/* Alertas por severidad */}
      {summary.alerts && summary.alerts.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="subtitle2">Alertas</Typography>
          {summary.alerts.map((alert) => (
            <Alert
              key={alert.alertId}
              severity={SEVERITY_COLORS[alert.severity]}
              icon={
                <Chip
                  label={SEVERITY_LABELS[alert.severity]}
                  size="small"
                  sx={{
                    backgroundColor: SEVERITY_BG_COLORS[alert.severity],
                    color: '#fff',
                    fontWeight: 'bold',
                    fontSize: '0.7rem',
                  }}
                />
              }
            >
              <Typography variant="body2">
                {alert.ruleName}: {alert.message}
              </Typography>
            </Alert>
          ))}
        </Box>
      )}

      {/* Tabla de resultados individuales */}
      {summary.results.length > 0 && (
        <TableContainer>
          <Table size="small" aria-label="Resultados de ejecución de reglas">
            <TableHead>
              <TableRow>
                <TableCell>Regla</TableCell>
                <TableCell>Resultado</TableCell>
                <TableCell>Registros Evaluados</TableCell>
                <TableCell>Cumplimiento</TableCell>
                <TableCell>Mensaje</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.results.map((r) => (
                <TableRow key={r.ruleId}>
                  <TableCell>{r.ruleName}</TableCell>
                  <TableCell>
                    <Chip
                      label={r.result === 'passed' ? 'Pasó' : 'Falló'}
                      color={r.result === 'passed' ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{r.details.recordsEvaluated}</TableCell>
                  <TableCell>{r.details.compliancePercent.toFixed(1)}%</TableCell>
                  <TableCell>{r.details.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}

/** Pestaña de gestión de reglas con tabla y filtros. */
function RulesManagementTab({
  rules,
  stageFilter,
  onStageFilterChange,
  onOpenCreate,
  onOpenEdit,
  onOpenDelete,
  isAdmin,
}: {
  rules: QualityRule[];
  stageFilter: CascadeStage | '';
  onStageFilterChange: (stage: CascadeStage | '') => void;
  onOpenCreate: () => void;
  onOpenEdit: (rule: QualityRule) => void;
  onOpenDelete: (rule: QualityRule) => void;
  isAdmin: boolean;
}) {
  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <FormControl sx={{ minWidth: 200 }} size="small">
          <InputLabel id="stage-filter-label">Filtrar por etapa</InputLabel>
          <Select
            labelId="stage-filter-label"
            value={stageFilter}
            label="Filtrar por etapa"
            onChange={(e) => onStageFilterChange(e.target.value as CascadeStage | '')}
          >
            <MenuItem value="">Todas las etapas</MenuItem>
            {STAGES.map((s) => (
              <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={onOpenCreate}>
            Nueva Regla
          </Button>
        )}
      </Box>

      {rules.length === 0 ? (
        <Alert severity="info">No hay reglas de calidad configuradas.</Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table aria-label="Tabla de reglas de calidad">
            <TableHead>
              <TableRow>
                <TableCell>Nombre</TableCell>
                <TableCell>Etapa</TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell>Expresión</TableCell>
                <TableCell>Columna</TableCell>
                <TableCell>Umbral</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.ruleId}>
                  <TableCell>{rule.ruleName}</TableCell>
                  <TableCell>{STAGES.find((s) => s.value === rule.stage)?.label ?? rule.stage}</TableCell>
                  <TableCell>{RULE_TYPES.find((t) => t.value === rule.type)?.label ?? rule.type}</TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {rule.expression}
                  </TableCell>
                  <TableCell>{rule.targetColumn ?? '—'}</TableCell>
                  <TableCell>{(rule.threshold * 100).toFixed(0)}%</TableCell>
                  <TableCell>
                    <Chip
                      label={rule.enabled ? 'Activa' : 'Inactiva'}
                      color={rule.enabled ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {isAdmin && (
                      <>
                        <IconButton aria-label="Editar regla" onClick={() => onOpenEdit(rule)} size="small">
                          <EditIcon />
                        </IconButton>
                        <IconButton aria-label="Eliminar regla" onClick={() => onOpenDelete(rule)} size="small" color="error">
                          <DeleteIcon />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}

/** Pestaña de resultados de ejecución — carga datos históricos desde DynamoDB. */
function ExecutionResultsTab({ refreshKey }: { refreshKey: number }) {
  const [results, setResults] = useState<QualityExecutionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [stageFilter, setStageFilter] = useState<CascadeStage | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      const filters: import('../../types/quality').ResultFilters = {};
      if (stageFilter) filters.stage = stageFilter;
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      const data = await qualityRulesService.getExecutionResults(
        Object.keys(filters).length > 0 ? filters : undefined,
      );
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [stageFilter, dateFrom, dateTo, refreshKey]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Filtros */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <FormControl sx={{ minWidth: 200 }} size="small">
          <InputLabel id="results-stage-filter-label">Filtrar por etapa</InputLabel>
          <Select
            labelId="results-stage-filter-label"
            value={stageFilter}
            label="Filtrar por etapa"
            onChange={(e) => setStageFilter(e.target.value as CascadeStage | '')}
          >
            <MenuItem value="">Todas las etapas</MenuItem>
            {STAGES.map((s) => (
              <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Fecha desde"
          type="date"
          size="small"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <TextField
          label="Fecha hasta"
          type="date"
          size="small"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && results.length === 0 && (
        <Alert severity="info">
          No hay resultados de ejecución disponibles. Los resultados aparecerán aquí después de ejecutar reglas sobre archivos cargados.
        </Alert>
      )}

      {!loading && results.map((summary, idx) => (
        <Paper key={idx} sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle1">
              Upload: {summary.uploadId}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {summary.executedAt}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Chip label={`Etapa: ${STAGES.find((s) => s.value === summary.stage)?.label ?? summary.stage}`} />
            <Chip label={`Total: ${summary.totalRules}`} />
            <Chip label={`Pasaron: ${summary.passed}`} color="success" />
            <Chip label={`Fallaron: ${summary.failed}`} color={summary.failed > 0 ? 'error' : 'default'} />
          </Box>
          <TableContainer>
            <Table size="small" aria-label="Resultados de ejecución de reglas">
              <TableHead>
                <TableRow>
                  <TableCell>Regla</TableCell>
                  <TableCell>Resultado</TableCell>
                  <TableCell>Registros Evaluados</TableCell>
                  <TableCell>Cumplimiento</TableCell>
                  <TableCell>Mensaje</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.results.map((r) => (
                  <TableRow key={r.ruleId}>
                    <TableCell>{r.ruleName}</TableCell>
                    <TableCell>
                      <Chip
                        label={r.result === 'passed' ? 'Pasó' : 'Falló'}
                        color={r.result === 'passed' ? 'success' : 'error'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{r.details.recordsEvaluated}</TableCell>
                    <TableCell>{r.details.compliancePercent.toFixed(1)}%</TableCell>
                    <TableCell>{r.details.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ))}
    </Box>
  );
}

/** Ejemplos DQDL por tipo de regla. */
const DQDL_EXAMPLES: Record<QualityRuleType, string> = {
  completeness: 'Completeness "columna" >= 1.0',
  uniqueness: 'Uniqueness "columna" >= 1.0',
  range: 'ColumnValues "columna" between 0 and 100',
  format: 'ColumnValues "columna" matches "regex"',
  referential: 'Completeness "columna" >= 1.0',
  custom: 'Expresión DQDL libre',
};

/** Diálogo de formulario para crear/editar regla. */
function RuleFormDialog({
  open,
  editing,
  form,
  formError,
  onFormChange,
  onSave,
  onClose,
}: {
  open: boolean;
  editing: boolean;
  form: RuleFormState;
  formError: string;
  onFormChange: (form: RuleFormState) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [dqdlValidationError, setDqdlValidationError] = useState('');

  const updateField = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) => {
    onFormChange({ ...form, [key]: value });
  };

  /** Maneja cambio de tipo de regla: auto-genera expresión base al crear. */
  const handleTypeChange = (newType: QualityRuleType) => {
    const column = form.targetColumn || 'columna';
    const baseExpression = generateBaseExpression(newType, column);
    onFormChange({ ...form, type: newType, expression: baseExpression });
    // Validar la expresión generada
    if (baseExpression) {
      const result = validateDqdlExpression(baseExpression);
      setDqdlValidationError(result.valid ? '' : result.error ?? '');
    } else {
      setDqdlValidationError('');
    }
  };

  /** Maneja cambio de expresión con validación en tiempo real. */
  const handleExpressionChange = (value: string) => {
    updateField('expression', value);
    if (value.trim()) {
      const result = validateDqdlExpression(value);
      setDqdlValidationError(result.valid ? '' : result.error ?? '');
    } else {
      setDqdlValidationError('');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Editar Regla' : 'Nueva Regla de Calidad'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {formError && <Alert severity="error">{formError}</Alert>}

        <TextField
          label="Nombre de la regla"
          value={form.ruleName}
          onChange={(e) => updateField('ruleName', e.target.value)}
          required
          fullWidth
        />

        {!editing && (
          <FormControl fullWidth>
            <InputLabel id="rule-stage-label">Etapa</InputLabel>
            <Select
              labelId="rule-stage-label"
              value={form.stage}
              label="Etapa"
              onChange={(e) => updateField('stage', e.target.value as CascadeStage)}
            >
              {STAGES.map((s) => (
                <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {!editing && (
          <FormControl fullWidth>
            <InputLabel id="rule-type-label">Tipo de regla</InputLabel>
            <Select
              labelId="rule-type-label"
              value={form.type}
              label="Tipo de regla"
              onChange={(e) => handleTypeChange(e.target.value as QualityRuleType)}
            >
              {RULE_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <TextField
          label="Expresión"
          value={form.expression}
          onChange={(e) => handleExpressionChange(e.target.value)}
          required
          fullWidth
          multiline
          rows={2}
          error={!!dqdlValidationError}
          helperText={dqdlValidationError || undefined}
        />

        {/* Texto de ayuda con ejemplo DQDL por tipo */}
        <Typography variant="caption" color="text.secondary" data-testid="dqdl-help-text">
          Ejemplo DQDL: {DQDL_EXAMPLES[form.type]}
        </Typography>

        <TextField
          label="Columna objetivo"
          value={form.targetColumn}
          onChange={(e) => updateField('targetColumn', e.target.value)}
          fullWidth
        />

        <TextField
          label="Umbral (0-1)"
          type="number"
          value={form.threshold}
          onChange={(e) => updateField('threshold', parseFloat(e.target.value) || 0)}
          inputProps={{ min: 0, max: 1, step: 0.01 }}
          fullWidth
        />

        <FormControlLabel
          control={
            <Switch
              checked={form.enabled}
              onChange={(e) => updateField('enabled', e.target.checked)}
            />
          }
          label="Regla activa"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button onClick={onSave} variant="contained">
          {editing ? 'Guardar Cambios' : 'Crear Regla'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
