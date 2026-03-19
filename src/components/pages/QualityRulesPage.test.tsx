import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QualityRulesPage from './QualityRulesPage';
import { qualityRulesService } from '../../services/quality-rules';
import type { QualityRule } from '../../types/quality';

// Mock del servicio de reglas de calidad
vi.mock('../../services/quality-rules', () => ({
  qualityRulesService: {
    listRules: vi.fn(() => []),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    getRule: vi.fn(),
  },
}));

/** Helper para obtener campo de texto por nombre parcial dentro de un contenedor. */
function getTextField(container: HTMLElement, name: RegExp) {
  // MUI required fields add " *" to label, so use regex matching
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
    vi.mocked(qualityRulesService.listRules).mockReturnValue([]);
  });

  it('muestra el título de la página', () => {
    render(<QualityRulesPage />);
    expect(screen.getByText('Reglas de Calidad')).toBeInTheDocument();
  });

  it('muestra mensaje cuando no hay reglas', () => {
    render(<QualityRulesPage />);
    expect(screen.getByText('No hay reglas de calidad configuradas.')).toBeInTheDocument();
  });

  it('muestra las pestañas de gestión y resultados', () => {
    render(<QualityRulesPage />);
    expect(screen.getByText('Gestión de Reglas')).toBeInTheDocument();
    expect(screen.getByText('Resultados de Ejecución')).toBeInTheDocument();
  });

  it('muestra tabla de reglas cuando existen', () => {
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
    vi.mocked(qualityRulesService.listRules).mockReturnValue(mockRules);

    render(<QualityRulesPage />);
    expect(screen.getByText('Completitud de invoice')).toBeInTheDocument();
    expect(screen.getByText('Geopos Local')).toBeInTheDocument();
    expect(screen.getByText('Completitud')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
  });

  it('abre diálogo de creación al hacer clic en Nueva Regla', async () => {
    render(<QualityRulesPage />);
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Nueva Regla de Calidad')).toBeInTheDocument();
    expect(getTextField(dialog, /Nombre de la regla/)).toBeInTheDocument();
  });

  it('muestra error de validación si el nombre está vacío al crear', async () => {
    render(<QualityRulesPage />);
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Crear Regla'));
    expect(within(dialog).getByText('El nombre de la regla es obligatorio')).toBeInTheDocument();
  });

  it('muestra error si la expresión está vacía al crear', async () => {
    render(<QualityRulesPage />);
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    await user.type(getTextField(dialog, /Nombre de la regla/), 'Mi regla');
    await user.click(within(dialog).getByText('Crear Regla'));
    expect(within(dialog).getByText('La expresión es obligatoria')).toBeInTheDocument();
  });

  it('crea una regla correctamente', { timeout: 15000 }, async () => {
    let created = false;
    vi.mocked(qualityRulesService.listRules).mockImplementation(() => {
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
    vi.mocked(qualityRulesService.createRule).mockImplementation(() => {
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
    await user.click(screen.getByText('Nueva Regla'));

    const dialog = await screen.findByRole('dialog');
    await user.type(getTextField(dialog, /Nombre de la regla/), 'Regla test');
    await user.type(getTextField(dialog, /Expresión/), 'IsComplete "col"');
    await user.click(within(dialog).getByText('Crear Regla'));

    expect(qualityRulesService.createRule).toHaveBeenCalledWith(
      expect.objectContaining({ ruleName: 'Regla test', expression: 'IsComplete "col"' }),
    );
    expect(screen.getByText('Regla test')).toBeInTheDocument();
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
    vi.mocked(qualityRulesService.listRules).mockReturnValue(mockRules);

    render(<QualityRulesPage />);
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
    vi.mocked(qualityRulesService.listRules).mockReturnValue(mockRules);

    render(<QualityRulesPage />);
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
    vi.mocked(qualityRulesService.listRules).mockImplementation(() => deleted ? [] : mockRules);
    vi.mocked(qualityRulesService.deleteRule).mockImplementation(() => {
      deleted = true;
      return true;
    });

    render(<QualityRulesPage />);
    await user.click(screen.getByLabelText('Eliminar regla'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Eliminar'));

    expect(qualityRulesService.deleteRule).toHaveBeenCalledWith('r1');
  });

  it('muestra mensaje vacío en pestaña de resultados', async () => {
    render(<QualityRulesPage />);
    await user.click(screen.getByText('Resultados de Ejecución'));
    expect(screen.getByText(/No hay resultados de ejecución disponibles/)).toBeInTheDocument();
  });

  it('muestra regla inactiva con chip correspondiente', () => {
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
    vi.mocked(qualityRulesService.listRules).mockReturnValue(mockRules);

    render(<QualityRulesPage />);
    expect(screen.getByText('Inactiva')).toBeInTheDocument();
  });
});
