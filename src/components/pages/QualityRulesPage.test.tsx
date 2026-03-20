import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QualityRulesPage from './QualityRulesPage';
import { qualityRulesService } from '../../services/quality-rules';
import { useAuth } from '../../hooks/useAuth';
import type { QualityRule, QualityExecutionSummary } from '../../types/quality';

// Mock del servicio de reglas de calidad (ahora async)
vi.mock('../../services/quality-rules', () => ({
  qualityRulesService: {
    listRules: vi.fn(async () => []),
    createRule: vi.fn(async () => ({})),
    updateRule: vi.fn(async () => ({})),
    deleteRule: vi.fn(async () => true),
    getRule: vi.fn(async () => null),
    executeRules: vi.fn(async () => ({})),
    getExecutionResults: vi.fn(async () => []),
  },
}));

// Mock del traductor DQDL
vi.mock('../../services/dqdl-translator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/dqdl-translator')>();
  return {
    ...actual,
    validateDqdlExpression: actual.validateDqdlExpression,
    generateBaseExpression: actual.generateBaseExpression,
  };
});

// Mock del hook useAuth — por defecto Administrator
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { userId: 'test', email: 'test@test.com', role: 'Administrator', displayName: 'Test' },
    role: 'Administrator',
    loading: false,
    isAuthenticated: true,
    hasPermission: () => true,
    hasRole: (r: string) => r === 'Administrator',
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  })),
}));

/** Helper para obtener campo de texto por nombre parcial dentro de un contenedor. */
function getTextField(container: HTMLElement, name: RegExp) {
  const inputs = within(container).getAllByRole('textbox');
  for (const input of inputs) {
    const label = input.closest('.MuiFormControl-root')?.querySelector('label');
    if (label && name.test(label.textContent ?? '')) return input;
  }
  throw new Error(`No se encontró campo con nombre ${name}`);
}

describe('QualityRulesPage', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(qualityRulesService.listRules).mockResolvedValue([]);
  });

  it('muestra el título de la página', async () => {
    render(<QualityRulesPage />);
    expect(screen.getByText('Reglas de Calidad')).toBeInTheDocument();
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
  });

  it('muestra mensaje cuando no hay reglas', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('No hay reglas de calidad configuradas.')).toBeInTheDocument();
    });
  });

  it('muestra las pestañas de gestión y resultados', async () => {
    render(<QualityRulesPage />);
    expect(screen.getByText('Gestión de Reglas')).toBeInTheDocument();
    expect(screen.getByText('Resultados de Ejecución')).toBeInTheDocument();
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
  });

  it('muestra tabla de reglas cuando existen', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Completitud de invoice',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'IsComplete "invoice"',
        targetColumn: 'invoice',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Completitud de invoice')).toBeInTheDocument();
    });
    expect(screen.getByText('Geopos Local')).toBeInTheDocument();
    expect(screen.getByText('Completitud')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
  });

  it('abre diálogo de creación al hacer clic en Nueva Regla', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Nueva Regla de Calidad')).toBeInTheDocument();
    expect(getTextField(dialog, /Nombre de la regla/)).toBeInTheDocument();
  });

  it('muestra error de validación si el nombre está vacío al crear', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Crear Regla'));
    expect(within(dialog).getByText('El nombre de la regla es obligatorio')).toBeInTheDocument();
  });

  it('muestra error si la expresión está vacía al crear', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    await user.type(getTextField(dialog, /Nombre de la regla/), 'Mi regla');
    await user.click(within(dialog).getByText('Crear Regla'));
    expect(within(dialog).getByText('La expresión es obligatoria')).toBeInTheDocument();
  });

  it('crea una regla correctamente', { timeout: 15000 }, async () => {
    let created = false;
    vi.mocked(qualityRulesService.listRules).mockImplementation(async () => {
      if (created) {
        return [{
          ruleId: 'new-rule',
          ruleName: 'Regla test',
          stage: 'geopos_local',
          type: 'completeness',
          expression: 'IsComplete "col"',
          threshold: 1.0,
          enabled: true,
          createdAt: new Date().toISOString(),
        }];
      }
      return [];
    });
    vi.mocked(qualityRulesService.createRule).mockImplementation(async () => {
      created = true;
      return {
        ruleId: 'new-rule',
        ruleName: 'Regla test',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'IsComplete "col"',
        threshold: 1.0,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
    });

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    await user.type(getTextField(dialog, /Nombre de la regla/), 'Regla test');
    await user.type(getTextField(dialog, /Expresión/), 'IsComplete "col"');
    await user.click(within(dialog).getByText('Crear Regla'));

    await waitFor(() => {
      expect(qualityRulesService.createRule).toHaveBeenCalledWith(
        expect.objectContaining({ ruleName: 'Regla test', expression: 'IsComplete "col"' }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Regla test')).toBeInTheDocument();
    });
  });

  it('abre diálogo de edición con datos precargados', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla existente',
        stage: 'integracion',
        type: 'range',
        expression: '0,100',
        targetColumn: 'TOTAL',
        threshold: 0.95,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Regla existente')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Editar regla'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Editar Regla')).toBeInTheDocument();
    expect(getTextField(dialog, /Nombre de la regla/)).toHaveValue('Regla existente');
  });

  it('abre diálogo de confirmación de eliminación', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla a eliminar',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'test',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Regla a eliminar')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Eliminar regla'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Confirmar Eliminación')).toBeInTheDocument();
    expect(within(dialog).getByText(/¿Está seguro/)).toBeInTheDocument();
  });

  it('elimina una regla al confirmar', async () => {
    let deleted = false;
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla a eliminar',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'test',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockImplementation(async () => deleted ? [] : mockRules);
    vi.mocked(qualityRulesService.deleteRule).mockImplementation(async () => {
      deleted = true;
      return true;
    });

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Regla a eliminar')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Eliminar regla'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Eliminar'));

    await waitFor(() => {
      expect(qualityRulesService.deleteRule).toHaveBeenCalledWith('r1');
    });
  });

  it('muestra mensaje vacío en pestaña de resultados', async () => {
    vi.mocked(qualityRulesService.getExecutionResults).mockResolvedValue([]);
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Resultados de Ejecución'));
    await waitFor(() => {
      expect(screen.getByText(/No hay resultados de ejecución disponibles/)).toBeInTheDocument();
    });
  });

  it('muestra regla inactiva con chip correspondiente', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla inactiva',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'test',
        threshold: 1.0,
        enabled: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Inactiva')).toBeInTheDocument();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tests para ejecución de reglas (nuevos)                           */
  /* ------------------------------------------------------------------ */

  it('muestra botón "Ejecutar Reglas" deshabilitado cuando no hay reglas activas', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    const btn = screen.getByRole('button', { name: /Ejecutar Reglas/i });
    expect(btn).toBeDisabled();
  });

  it('muestra botón "Ejecutar Reglas" habilitado cuando hay reglas activas', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla activa',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'test',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Regla activa')).toBeInTheDocument();
    });
    const btn = screen.getByRole('button', { name: /Ejecutar Reglas/i });
    expect(btn).toBeEnabled();
  });

  it('muestra indicador de carga durante ejecución', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla activa',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'test',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

    // Make executeRules hang to test loading state
    let resolveExecution: (value: QualityExecutionSummary) => void;
    vi.mocked(qualityRulesService.executeRules).mockImplementation(
      () => new Promise((resolve) => { resolveExecution = resolve; }),
    );

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Regla activa')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Ejecutar Reglas/i }));

    await waitFor(() => {
      expect(screen.getByText('Ejecutando reglas de calidad...')).toBeInTheDocument();
    });

    // Resolve to clean up
    resolveExecution!({
      uploadId: 'u1',
      stage: 'geopos_local',
      totalRules: 1,
      passed: 1,
      failed: 0,
      results: [],
      alerts: [],
      executedAt: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(screen.queryByText('Ejecutando reglas de calidad...')).not.toBeInTheDocument();
    });
  });

  it('muestra resumen de resultados al completar ejecución', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla activa',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'test',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

    const mockSummary: QualityExecutionSummary = {
      uploadId: 'u1',
      stage: 'geopos_local',
      totalRules: 3,
      passed: 2,
      failed: 1,
      results: [
        {
          uploadId: 'u1',
          ruleId: 'r1',
          ruleName: 'Regla 1',
          ruleExpression: 'test',
          result: 'passed',
          details: { recordsEvaluated: 100, recordsPassed: 100, recordsFailed: 0, compliancePercent: 100, message: 'OK' },
          executedAt: new Date().toISOString(),
        },
      ],
      alerts: [],
      executedAt: new Date().toISOString(),
    };
    vi.mocked(qualityRulesService.executeRules).mockResolvedValue(mockSummary);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Regla activa')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Ejecutar Reglas/i }));

    await waitFor(() => {
      expect(screen.getByText('Resumen de Ejecución')).toBeInTheDocument();
    });
    expect(screen.getByText('Total: 3')).toBeInTheDocument();
    expect(screen.getByText('Pasaron: 2')).toBeInTheDocument();
    expect(screen.getByText('Fallaron: 1')).toBeInTheDocument();
  });

  it('muestra error descriptivo cuando la ejecución falla', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla activa',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'test',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);
    vi.mocked(qualityRulesService.executeRules).mockRejectedValue(
      new Error('Archivo S3 no encontrado: uploads/test.csv'),
    );

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Regla activa')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Ejecutar Reglas/i }));

    await waitFor(() => {
      expect(screen.getByText('Archivo S3 no encontrado: uploads/test.csv')).toBeInTheDocument();
    });
  });

  it('muestra alertas con chips de severidad al completar ejecución', async () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla activa',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'test',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

    const mockSummary: QualityExecutionSummary = {
      uploadId: 'u1',
      stage: 'geopos_local',
      totalRules: 2,
      passed: 0,
      failed: 2,
      results: [],
      alerts: [
        {
          alertId: 'a1',
          uploadId: 'u1',
          ruleId: 'r1',
          ruleName: 'Completitud nombre',
          stage: 'geopos_local',
          severity: 'critical',
          message: 'Solo 10% de cumplimiento',
          details: { recordsEvaluated: 100, recordsPassed: 10, recordsFailed: 90, compliancePercent: 10, message: '' },
          createdAt: new Date().toISOString(),
        },
        {
          alertId: 'a2',
          uploadId: 'u1',
          ruleId: 'r2',
          ruleName: 'Unicidad código',
          stage: 'geopos_local',
          severity: 'low',
          message: '80% de cumplimiento',
          details: { recordsEvaluated: 100, recordsPassed: 80, recordsFailed: 20, compliancePercent: 80, message: '' },
          createdAt: new Date().toISOString(),
        },
      ],
      executedAt: new Date().toISOString(),
    };
    vi.mocked(qualityRulesService.executeRules).mockResolvedValue(mockSummary);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Regla activa')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Ejecutar Reglas/i }));

    await waitFor(() => {
      expect(screen.getByText('Alertas')).toBeInTheDocument();
    });
    expect(screen.getByText('Crítica')).toBeInTheDocument();
    expect(screen.getByText('Baja')).toBeInTheDocument();
    expect(screen.getByText(/Completitud nombre: Solo 10% de cumplimiento/)).toBeInTheDocument();
    expect(screen.getByText(/Unicidad código: 80% de cumplimiento/)).toBeInTheDocument();
  });

  it('muestra error al cargar reglas desde el servicio', async () => {
    vi.mocked(qualityRulesService.listRules).mockRejectedValue(
      new Error('Error de conexión'),
    );

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Error de conexión')).toBeInTheDocument();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tests para validación DQDL en formulario (Req 6.1-6.4)           */
  /* ------------------------------------------------------------------ */

  it('auto-genera expresión base al cambiar tipo de regla en creación', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');

    // Abrir el select de tipo de regla y seleccionar "Unicidad"
    const typeSelect = within(dialog).getByLabelText('Tipo de regla');
    await user.click(typeSelect);
    const uniquenessOption = await screen.findByRole('option', { name: 'Unicidad' });
    await user.click(uniquenessOption);

    // Verificar que la expresión se auto-generó
    const expressionField = getTextField(dialog, /Expresión/);
    expect(expressionField).toHaveValue('Uniqueness "columna" >= 1.0');
  });

  it('muestra error de validación inline para expresión DQDL inválida', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    const expressionField = getTextField(dialog, /Expresión/);

    // Escribir una expresión inválida
    await user.type(expressionField, 'INVALID EXPRESSION');

    // Verificar que se muestra el error de validación inline
    await waitFor(() => {
      expect(within(dialog).getByText(/Expresión DQDL no reconocida/)).toBeInTheDocument();
    });
  });

  it('no muestra error de validación para expresión DQDL válida', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    const expressionField = getTextField(dialog, /Expresión/);

    await user.type(expressionField, 'Completeness "col" >= 1.0');

    // No debe haber error de validación
    await waitFor(() => {
      expect(within(dialog).queryByText(/Expresión DQDL no reconocida/)).not.toBeInTheDocument();
    });
  });

  it('muestra texto de ayuda con ejemplo DQDL por tipo de regla', async () => {
    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');

    // Por defecto el tipo es "completeness"
    expect(within(dialog).getByText(/Ejemplo DQDL:.*Completeness "columna" >= 1\.0/)).toBeInTheDocument();

    // Cambiar a tipo "range"
    const typeSelect = within(dialog).getByLabelText('Tipo de regla');
    await user.click(typeSelect);
    const rangeOption = await screen.findByRole('option', { name: 'Rango' });
    await user.click(rangeOption);

    // Verificar que el ejemplo cambió
    expect(within(dialog).getByText(/Ejemplo DQDL:.*ColumnValues "columna" between 0 and 100/)).toBeInTheDocument();
  });

  /* ------------------------------------------------------------------ */
  /*  Tests para pestaña Resultados de Ejecución (Req 4.4, 7.1-7.4)   */
  /* ------------------------------------------------------------------ */

  it('carga resultados históricos al cambiar a pestaña de resultados', async () => {
    const mockResults: QualityExecutionSummary[] = [
      {
        uploadId: 'u1',
        stage: 'geopos_local',
        totalRules: 2,
        passed: 1,
        failed: 1,
        results: [
          {
            uploadId: 'u1',
            ruleId: 'r1',
            ruleName: 'Completitud nombre',
            ruleExpression: 'Completeness "nombre" >= 1.0',
            result: 'passed',
            details: { recordsEvaluated: 100, recordsPassed: 100, recordsFailed: 0, compliancePercent: 100, message: 'Todos los registros cumplen' },
            executedAt: '2024-06-01T10:00:00Z',
          },
          {
            uploadId: 'u1',
            ruleId: 'r2',
            ruleName: 'Unicidad código',
            ruleExpression: 'Uniqueness "codigo" >= 1.0',
            result: 'failed',
            details: { recordsEvaluated: 100, recordsPassed: 80, recordsFailed: 20, compliancePercent: 80, message: '20 duplicados encontrados' },
            executedAt: '2024-06-01T10:00:00Z',
          },
        ],
        alerts: [],
        executedAt: '2024-06-01T10:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.getExecutionResults).mockResolvedValue(mockResults);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });

    await user.click(screen.getByText('Resultados de Ejecución'));

    await waitFor(() => {
      expect(qualityRulesService.getExecutionResults).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('Upload: u1')).toBeInTheDocument();
    });
  });

  it('muestra detalles individuales de resultados en la pestaña', async () => {
    const mockResults: QualityExecutionSummary[] = [
      {
        uploadId: 'u1',
        stage: 'integracion',
        totalRules: 1,
        passed: 0,
        failed: 1,
        results: [
          {
            uploadId: 'u1',
            ruleId: 'r1',
            ruleName: 'Rango de total',
            ruleExpression: 'ColumnValues "total" between 0 and 1000',
            result: 'failed',
            details: { recordsEvaluated: 50, recordsPassed: 40, recordsFailed: 10, compliancePercent: 80, message: '10 valores fuera de rango' },
            executedAt: '2024-06-01T10:00:00Z',
          },
        ],
        alerts: [],
        executedAt: '2024-06-01T10:00:00Z',
      },
    ];
    vi.mocked(qualityRulesService.getExecutionResults).mockResolvedValue(mockResults);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });

    await user.click(screen.getByText('Resultados de Ejecución'));

    await waitFor(() => {
      expect(screen.getByText('Rango de total')).toBeInTheDocument();
    });
    expect(screen.getByText('Falló')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('80.0%')).toBeInTheDocument();
    expect(screen.getByText('10 valores fuera de rango')).toBeInTheDocument();
  });

  it('filtra resultados por CascadeStage en pestaña de resultados', async () => {
    vi.mocked(qualityRulesService.getExecutionResults).mockResolvedValue([]);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });

    await user.click(screen.getByText('Resultados de Ejecución'));

    await waitFor(() => {
      expect(qualityRulesService.getExecutionResults).toHaveBeenCalled();
    });

    // Seleccionar filtro de etapa en la pestaña de resultados
    const stageSelects = screen.getAllByLabelText('Filtrar por etapa');
    // El segundo select es el de la pestaña de resultados
    const resultsStageSelect = stageSelects[stageSelects.length - 1];
    await user.click(resultsStageSelect);
    const option = await screen.findByRole('option', { name: 'Integración' });
    await user.click(option);

    await waitFor(() => {
      expect(qualityRulesService.getExecutionResults).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'integracion' }),
      );
    });
  });

  it('filtra resultados por rango de fechas en pestaña de resultados', async () => {
    vi.mocked(qualityRulesService.getExecutionResults).mockResolvedValue([]);

    render(<QualityRulesPage />);
    await waitFor(() => {
      expect(qualityRulesService.listRules).toHaveBeenCalled();
    });

    await user.click(screen.getByText('Resultados de Ejecución'));

    await waitFor(() => {
      expect(qualityRulesService.getExecutionResults).toHaveBeenCalled();
    });

    // Establecer fecha desde
    const dateFromInput = screen.getByLabelText('Fecha desde');
    await user.clear(dateFromInput);
    await user.type(dateFromInput, '2024-01-01');

    await waitFor(() => {
      expect(qualityRulesService.getExecutionResults).toHaveBeenCalledWith(
        expect.objectContaining({ dateFrom: '2024-01-01' }),
      );
    });

    // Establecer fecha hasta
    const dateToInput = screen.getByLabelText('Fecha hasta');
    await user.clear(dateToInput);
    await user.type(dateToInput, '2024-12-31');

    await waitFor(() => {
      expect(qualityRulesService.getExecutionResults).toHaveBeenCalledWith(
        expect.objectContaining({ dateFrom: '2024-01-01', dateTo: '2024-12-31' }),
      );
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tests para control de permisos en la UI (Req 8.1, 8.2, 8.4)     */
  /* ------------------------------------------------------------------ */

  describe('permisos de usuario', () => {
    const mockRules: QualityRule[] = [
      {
        ruleId: 'r1',
        ruleName: 'Regla de prueba',
        stage: 'geopos_local',
        type: 'completeness',
        expression: 'Completeness "col" >= 1.0',
        targetColumn: 'col',
        threshold: 1.0,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    it('usuario Administrador ve botones de crear, editar y eliminar', async () => {
      vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

      render(<QualityRulesPage />);
      await waitFor(() => {
        expect(screen.getByText('Regla de prueba')).toBeInTheDocument();
      });

      expect(screen.getByText('Nueva Regla')).toBeInTheDocument();
      expect(screen.getByLabelText('Editar regla')).toBeInTheDocument();
      expect(screen.getByLabelText('Eliminar regla')).toBeInTheDocument();
    });

    it('usuario Operador NO ve botones de crear, editar ni eliminar', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { userId: 'op', email: 'op@test.com', role: 'Operator', displayName: 'Operator' } as any,
        role: 'Operator',
        loading: false,
        isAuthenticated: true,
        hasPermission: () => false,
        hasRole: (r: string) => r === 'Operator',
        signOut: vi.fn(),
        refreshProfile: vi.fn(),
      });
      vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

      render(<QualityRulesPage />);
      await waitFor(() => {
        expect(screen.getByText('Regla de prueba')).toBeInTheDocument();
      });

      expect(screen.queryByText('Nueva Regla')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Editar regla')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Eliminar regla')).not.toBeInTheDocument();
    });

    it('usuario Operador puede ver reglas y ejecutarlas', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { userId: 'op', email: 'op@test.com', role: 'Operator', displayName: 'Operator' } as any,
        role: 'Operator',
        loading: false,
        isAuthenticated: true,
        hasPermission: () => false,
        hasRole: (r: string) => r === 'Operator',
        signOut: vi.fn(),
        refreshProfile: vi.fn(),
      });
      vi.mocked(qualityRulesService.listRules).mockResolvedValue(mockRules);

      render(<QualityRulesPage />);
      await waitFor(() => {
        expect(screen.getByText('Regla de prueba')).toBeInTheDocument();
      });

      // Puede ver la tabla de reglas
      expect(screen.getByText('Completitud')).toBeInTheDocument();
      expect(screen.getByText('Geopos Local')).toBeInTheDocument();

      // Puede ver y usar el botón de ejecutar
      const executeBtn = screen.getByRole('button', { name: /Ejecutar Reglas/i });
      expect(executeBtn).toBeEnabled();
    });

    it('usuario Operador puede ver la pestaña de resultados', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { userId: 'op', email: 'op@test.com', role: 'Operator', displayName: 'Operator' } as any,
        role: 'Operator',
        loading: false,
        isAuthenticated: true,
        hasPermission: () => false,
        hasRole: (r: string) => r === 'Operator',
        signOut: vi.fn(),
        refreshProfile: vi.fn(),
      });
      vi.mocked(qualityRulesService.getExecutionResults).mockResolvedValue([]);

      render(<QualityRulesPage />);
      await waitFor(() => {
        expect(qualityRulesService.listRules).toHaveBeenCalled();
      });

      await user.click(screen.getByText('Resultados de Ejecución'));

      await waitFor(() => {
        expect(screen.getByText(/No hay resultados de ejecución disponibles/)).toBeInTheDocument();
      });
    });
  });
});
