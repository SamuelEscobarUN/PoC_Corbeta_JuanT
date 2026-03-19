import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from './AdminPage';
import { UserManagementService } from '../../services/user-management';
import { DashboardService } from '../../services/dashboard';
import type { UserProfile } from '../../types/auth';
import type { PaginatedResult } from '../../types/user-management';
import type { DashboardData } from '../../types/dashboard';

// Mock UserManagementService
vi.mock('../../services/user-management', () => {
  const mockInstance = {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deactivateUser: vi.fn(),
    deleteUser: vi.fn(),
    assignRole: vi.fn(),
  };
  return {
    UserManagementService: {
      getInstance: vi.fn(() => mockInstance),
    },
  };
});

// Mock DashboardService
vi.mock('../../services/dashboard', () => {
  const mockInstance = {
    getDashboardData: vi.fn(),
  };
  return {
    DashboardService: {
      getInstance: vi.fn(() => mockInstance),
    },
  };
});

const mockUsers: UserProfile[] = [
  { userId: 'u1', email: 'admin@test.com', role: 'Administrator', permissions: ['users:manage'], isActive: true },
  { userId: 'u2', email: 'operator@test.com', role: 'Operator', permissions: ['upload:csv'], isActive: true },
  { userId: 'u3', email: 'inactive@test.com', role: 'Operator', permissions: [], isActive: false },
];

const mockPaginatedUsers: PaginatedResult<UserProfile> = {
  items: mockUsers,
  total: 3,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

const mockDashboardData: DashboardData = {
  reconciliation: {
    totalInvoices: 500,
    invoicesWithDiscrepancies: 25,
    discrepancyRate: 0.05,
    countByType: {
      missing_invoice: 5,
      total_difference: 10,
      item_count_difference: 3,
      missing_item: 7,
    },
  },
  stageDiscrepancies: [],
  quality: {
    totalRules: 15,
    passed: 12,
    failed: 3,
    byDataset: [],
  },
  remediation: {
    proposed: 20,
    pendingApproval: 8,
    approved: 10,
    rejected: 2,
    xmlGenerated: 9,
  },
};

function getUserService() {
  return UserManagementService.getInstance() as unknown as {
    listUsers: ReturnType<typeof vi.fn>;
    createUser: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    deactivateUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
    assignRole: ReturnType<typeof vi.fn>;
  };
}

function getDashService() {
  return DashboardService.getInstance() as unknown as {
    getDashboardData: ReturnType<typeof vi.fn>;
  };
}

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserService().listUsers.mockResolvedValue(mockPaginatedUsers);
    getDashService().getDashboardData.mockResolvedValue(mockDashboardData);
  });

  it('muestra el título del panel de administración', async () => {
    render(<AdminPage />);
    expect(screen.getByText('Panel de Administración')).toBeInTheDocument();
  });

  it('muestra las 4 pestañas', async () => {
    render(<AdminPage />);
    expect(screen.getByText('Gestión de Usuarios')).toBeInTheDocument();
    expect(screen.getByText('Asignación de Roles')).toBeInTheDocument();
    expect(screen.getByText('Configuración')).toBeInTheDocument();
    expect(screen.getByText('Supervisión')).toBeInTheDocument();
  });

  /* ---------------------------------------------------------------- */
  /*  Tab 1: Gestión de Usuarios                                      */
  /* ---------------------------------------------------------------- */
  describe('Gestión de Usuarios', () => {
    it('muestra tabla de usuarios con datos', async () => {
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      expect(screen.getByText('operator@test.com')).toBeInTheDocument();
      expect(screen.getByText('inactive@test.com')).toBeInTheDocument();
    });

    it('muestra roles de usuarios como chips', async () => {
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      expect(screen.getAllByText('Administrador').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Operador').length).toBeGreaterThanOrEqual(1);
    });

    it('muestra estado activo/inactivo', async () => {
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      expect(screen.getAllByText('Activo').length).toBe(2);
      expect(screen.getAllByText('Inactivo').length).toBe(1);
    });

    it('muestra botón Crear Usuario', async () => {
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('Crear Usuario')).toBeInTheDocument();
      });
    });

    it('abre diálogo de crear usuario al hacer clic', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('Crear Usuario')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Crear Usuario'));
      expect(screen.getByText('Correo electrónico')).toBeInTheDocument();
    });

    it('muestra mensaje cuando no hay usuarios', async () => {
      getUserService().listUsers.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('No hay usuarios registrados.')).toBeInTheDocument();
      });
    });

    it('muestra error cuando falla la carga de usuarios', async () => {
      getUserService().listUsers.mockRejectedValue(new Error('Network error'));
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('tiene botones de editar, desactivar y eliminar por usuario', async () => {
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      expect(screen.getByLabelText('Editar admin@test.com')).toBeInTheDocument();
      expect(screen.getByLabelText('Desactivar admin@test.com')).toBeInTheDocument();
      expect(screen.getByLabelText('Eliminar admin@test.com')).toBeInTheDocument();
    });

    it('abre diálogo de editar al hacer clic en editar', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByLabelText('Editar admin@test.com'));
      expect(screen.getByText('Editar Usuario')).toBeInTheDocument();
    });

    it('llama a deleteUser al hacer clic en eliminar', async () => {
      const user = userEvent.setup();
      getUserService().deleteUser.mockResolvedValue(undefined);
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByLabelText('Eliminar admin@test.com'));
      await waitFor(() => {
        expect(getUserService().deleteUser).toHaveBeenCalledWith('u1');
      });
    });

    it('llama a deactivateUser al hacer clic en desactivar', async () => {
      const user = userEvent.setup();
      getUserService().deactivateUser.mockResolvedValue(undefined);
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByLabelText('Desactivar admin@test.com'));
      await waitFor(() => {
        expect(getUserService().deactivateUser).toHaveBeenCalledWith('u1');
      });
    });

    it('el botón desactivar está deshabilitado para usuarios inactivos', async () => {
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('inactive@test.com')).toBeInTheDocument();
      });
      expect(screen.getByLabelText('Desactivar inactive@test.com')).toBeDisabled();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Tab 2: Asignación de Roles                                      */
  /* ---------------------------------------------------------------- */
  describe('Asignación de Roles', () => {
    it('muestra formulario de asignación de rol', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Asignación de Roles'));
      expect(screen.getByText('Asignación de Rol y Permisos')).toBeInTheDocument();
    });

    it('muestra selector de usuario y rol', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Asignación de Roles'));
      expect(screen.getByLabelText('Usuario')).toBeInTheDocument();
      expect(screen.getByLabelText('Rol')).toBeInTheDocument();
    });

    it('muestra chips de permisos', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Asignación de Roles'));
      expect(screen.getByText('Permisos')).toBeInTheDocument();
      expect(screen.getByText('upload:csv')).toBeInTheDocument();
      expect(screen.getByText('users:manage')).toBeInTheDocument();
    });

    it('muestra botón Asignar Rol', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Asignación de Roles'));
      expect(screen.getByText('Asignar Rol')).toBeInTheDocument();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Tab 3: Configuración del Sistema                                */
  /* ---------------------------------------------------------------- */
  describe('Configuración del Sistema', () => {
    it('muestra configuración del sistema', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await user.click(screen.getByText('Configuración'));
      expect(screen.getByText('Configuración del Sistema')).toBeInTheDocument();
    });

    it('muestra umbrales de tolerancia', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await user.click(screen.getByText('Configuración'));
      expect(screen.getByText('Umbrales de Tolerancia')).toBeInTheDocument();
      expect(screen.getByText(/Tolerancia:/)).toBeInTheDocument();
    });

    it('muestra opciones de notificaciones', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await user.click(screen.getByText('Configuración'));
      expect(screen.getByText('Notificaciones habilitadas')).toBeInTheDocument();
      expect(screen.getByText('Notificaciones por correo')).toBeInTheDocument();
    });

    it('muestra opción de procesamiento automático', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await user.click(screen.getByText('Configuración'));
      expect(screen.getByText('Procesamiento automático tras carga')).toBeInTheDocument();
    });

    it('muestra botón Guardar Configuración', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await user.click(screen.getByText('Configuración'));
      expect(screen.getByText('Guardar Configuración')).toBeInTheDocument();
    });

    it('muestra mensaje de éxito al guardar', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await user.click(screen.getByText('Configuración'));
      await user.click(screen.getByText('Guardar Configuración'));
      expect(screen.getByText('Configuración guardada correctamente.')).toBeInTheDocument();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Tab 4: Supervisión                                              */
  /* ---------------------------------------------------------------- */
  describe('Supervisión', () => {
    it('muestra datos de supervisión', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Supervisión'));
      await waitFor(() => {
        expect(screen.getByText('Supervisión del Sistema')).toBeInTheDocument();
      });
    });

    it('muestra tarjetas de métricas de supervisión', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Supervisión'));
      await waitFor(() => {
        expect(screen.getByText('Supervisión del Sistema')).toBeInTheDocument();
      });
      expect(screen.getByText('Total Facturas')).toBeInTheDocument();
      expect(screen.getByText('Reglas de Calidad')).toBeInTheDocument();
      expect(screen.getByText('Discrepancias')).toBeInTheDocument();
      expect(screen.getByText('Remediaciones')).toBeInTheDocument();
    });

    it('muestra valores correctos de métricas', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Supervisión'));
      await waitFor(() => {
        expect(screen.getByText('500')).toBeInTheDocument();
      });
      expect(screen.getByText('15')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument();
    });

    it('muestra tabla de discrepancias por tipo', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Supervisión'));
      await waitFor(() => {
        expect(screen.getByText('Supervisión del Sistema')).toBeInTheDocument();
      });
      // Check the supervision tab's discrepancy type table
      const supervisionPanel = screen.getByRole('tabpanel', { hidden: false });
      expect(within(supervisionPanel).getByText('Factura perdida')).toBeInTheDocument();
      expect(within(supervisionPanel).getByText('Diferencia de total')).toBeInTheDocument();
    });

    it('muestra tabla de estado de remediación', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Supervisión'));
      await waitFor(() => {
        expect(screen.getByText('Supervisión del Sistema')).toBeInTheDocument();
      });
      const supervisionPanel = screen.getByRole('tabpanel', { hidden: false });
      expect(within(supervisionPanel).getByText('Pendientes de aprobación')).toBeInTheDocument();
      expect(within(supervisionPanel).getByText('Aprobadas')).toBeInTheDocument();
      expect(within(supervisionPanel).getByText('Rechazadas')).toBeInTheDocument();
      expect(within(supervisionPanel).getByText('XML Generados')).toBeInTheDocument();
    });

    it('muestra error cuando falla la carga de supervisión', async () => {
      getDashService().getDashboardData.mockRejectedValue(new Error('Dashboard error'));
      const user = userEvent.setup();
      render(<AdminPage />);
      await user.click(screen.getByText('Supervisión'));
      await waitFor(() => {
        expect(screen.getByText('Dashboard error')).toBeInTheDocument();
      });
    });
  });
});
