/**
 * QualityRulesPage — Página de gestión de reglas de calidad (solo Administrador).
 *
 * Permite crear, editar, eliminar y listar reglas de calidad por etapa.
 * Muestra resultados de ejecución por archivo/dataset.
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
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { qualityRulesService } from '../../services/quality-rules';
import type { CascadeStage } from '../../types/csv';
import type {
  QualityRule,
  QualityRuleType,
  QualityExecutionSummary,
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
  const [rules, setRules] = useState<QualityRule[]>([]);
  const [stageFilter, setStageFilter] = useState<CascadeStage | ''>('');
  const [tabIndex, setTabIndex] = useState(0);

  // Diálogo crear/editar
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<QualityRule | null>(null);
  const [form, setForm] = useState<RuleFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState('');

  // Diálogo eliminar
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRule, setDeletingRule] = useState<QualityRule | null>(null);

  // Resultados de ejecución (se poblarán al integrar con el backend)
  const [executionResults] = useState<QualityExecutionSummary[]>([]);

  /** Cargar reglas desde el servicio. */
  const loadRules = useCallback(() => {
    const stage = stageFilter || undefined;
    const loaded = qualityRulesService.listRules(stage);
    setRules(loaded);
  }, [stageFilter]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  /* ------------------------------------------------------------------ */
  /*  Handlers de formulario                                            */
  /* ------------------------------------------------------------------ */

  const handleOpenCreate = () => {
    setEditingRule(null);
    setForm(INITIAL_FORM);
    setFormError('');
    setDialogOpen(true);
  };

  const handleOpenEdit = (rule: QualityRule) => {
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

  const handleSave = () => {
    if (!form.ruleName.trim()) {
      setFormError('El nombre de la regla es obligatorio');
      return;
    }
    if (!form.expression.trim()) {
      setFormError('La expresión es obligatoria');
      return;
    }

    if (editingRule) {
      qualityRulesService.updateRule(editingRule.ruleId, {
        ruleName: form.ruleName,
        expression: form.expression,
        targetColumn: form.targetColumn || undefined,
        threshold: form.threshold,
        enabled: form.enabled,
      });
    } else {
      qualityRulesService.createRule({
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
    loadRules();
  };

  /* ------------------------------------------------------------------ */
  /*  Handlers de eliminación                                           */
  /* ------------------------------------------------------------------ */

  const handleOpenDelete = (rule: QualityRule) => {
    setDeletingRule(rule);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (deletingRule) {
      qualityRulesService.deleteRule(deletingRule.ruleId);
      loadRules();
    }
    setDeleteDialogOpen(false);
    setDeletingRule(null);
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

      {tabIndex === 0 && (
        <RulesManagementTab
          rules={rules}
          stageFilter={stageFilter}
          onStageFilterChange={setStageFilter}
          onOpenCreate={handleOpenCreate}
          onOpenEdit={handleOpenEdit}
          onOpenDelete={handleOpenDelete}
        />
      )}

      {tabIndex === 1 && (
        <ExecutionResultsTab results={executionResults} />
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

/** Pestaña de gestión de reglas con tabla y filtros. */
function RulesManagementTab({
  rules,
  stageFilter,
  onStageFilterChange,
  onOpenCreate,
  onOpenEdit,
  onOpenDelete,
}: {
  rules: QualityRule[];
  stageFilter: CascadeStage | '';
  onStageFilterChange: (stage: CascadeStage | '') => void;
  onOpenCreate: () => void;
  onOpenEdit: (rule: QualityRule) => void;
  onOpenDelete: (rule: QualityRule) => void;
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

        <Button variant="contained" startIcon={<AddIcon />} onClick={onOpenCreate}>
          Nueva Regla
        </Button>
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
                    <IconButton aria-label="Editar regla" onClick={() => onOpenEdit(rule)} size="small">
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="Eliminar regla" onClick={() => onOpenDelete(rule)} size="small" color="error">
                      <DeleteIcon />
                    </IconButton>
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

/** Pestaña de resultados de ejecución. */
function ExecutionResultsTab({ results }: { results: QualityExecutionSummary[] }) {
  if (results.length === 0) {
    return (
      <Alert severity="info">
        No hay resultados de ejecución disponibles. Los resultados aparecerán aquí después de ejecutar reglas sobre archivos cargados.
      </Alert>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {results.map((summary, idx) => (
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
  const updateField = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) => {
    onFormChange({ ...form, [key]: value });
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
              onChange={(e) => updateField('type', e.target.value as QualityRuleType)}
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
          onChange={(e) => updateField('expression', e.target.value)}
          required
          fullWidth
          multiline
          rows={2}
        />

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
