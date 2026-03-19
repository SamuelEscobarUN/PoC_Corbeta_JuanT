import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from './DashboardPage';
import { DashboardService } from '../../services/dashboard';
import type { DashboardData } from '../../types/dashboard';

// Mock del servicio de dashboard
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

/** Datos de prueba para el dashboard. */
const mockDashboardData: DashboardData = {
  reconciliation: {
    totalInvoices: 1000,
    invoicesWithDiscrepancies: 50,
    discrepancyRate: 0.05,
    countByType: {
      missing_invoice: 10,
      total_difference: 20,
      item_count_difference: 5,
      missing_item: 15,
    },
  },
  stageDiscrepancies: [
    {
      stagePair: { source: 'geopos_local', target: 'geopos_central' },
      discrepancies: [
        {
          discrepancyId: 'd1',
          sourceStage: 'geopos_local',
          targetStage: 'geopos_central',
          invoice: 'INV-001',
          type: 'missing_invoice',
          details: { message: 'Factura no encontrada en Geopos Central' },
          severity: 'high',
          detectedAt: '2024-01-15T10:00:00Z',
        },
      ],
      count: 1,
    },
  ],
  quality: {
    totalRules: 20,
    passed: 18,
    failed: 2,
    byDataset: [
      {
        uploadId: 'upload-abc',
        stage: 'geopos_local',
        totalRules: 10,
        passed: 9,
        failed: 1,
      },
    ],
  },
  remediation: {
    proposed: 30,
    pendingApproval: 10,
    approved: 15,
    rejected: 5,
    xmlGenerated: 12,
  },
};

function getMockService() {
  return DashboardService.getInstance() as unknown as {
    getDashboardData: ReturnType<typeof vi.fn>;
  };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra estado de carga inicialmente', () => {
    getMockService().getDashboardData.mockReturnValue(new Promise(() => {}));
    render(<DashboardPage />);
    expect(screen.getByRole('status', { name: /cargando/i })).toBeInTheDocument();
    expect(screen.getByText('Cargando datos del dashboard…')).toBeInTheDocument();
  });

  it('muestra error cuando falla la carga de datos', async () => {
    getMockService().getDashboardData.mockRejectedValue(new Error('Network error'));
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('No se pudieron cargar los datos del dashboard.')).toBeInTheDocument();
    });
  });

  it('muestra el título del dashboard', async () => {
    getMockService().getDashboardData.mockResolvedValue(mockDashboardData);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('muestra tarjetas de resumen con métricas correctas', async () => {
    getMockService().getDashboardData.mockResolvedValue(mockDashboardData);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Facturas')).toBeInTheDocument();
      expect(screen.getByText('Con Discrepancias')).toBeInTheDocument();
      expect(screen.getByText('Tasa de Discrepancia')).toBeInTheDocument();
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    // Verificar valores
    expect(screen.getByText('5.0%')).toBeInTheDocument();
    expect(screen.getByText('15 aprobadas / 10 pendientes')).toBeInTheDocument();
  });

  it('muestra sección de discrepancias por tipo', async () => {
    getMockService().getDashboardData.mockResolvedValue(mockDashboardData);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Discrepancias por Tipo')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Factura perdida').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Diferencia de total').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Diferencia de ítems')).toBeInTheDocument();
    expect(screen.getAllByText('Ítem perdido').length).toBeGreaterThanOrEqual(1);
  });

  it('muestra sección de discrepancias por etapa', async () => {
    getMockService().getDashboardData.mockResolvedValue(mockDashboardData);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Discrepancias por Etapa')).toBeInTheDocument();
    });
    expect(screen.getByText(/Geopos Local → Geopos Central/)).toBeInTheDocument();
    expect(screen.getByText('INV-001')).toBeInTheDocument();
  });

  it('muestra sección de resultados de calidad', async () => {
    getMockService().getDashboardData.mockResolvedValue(mockDashboardData);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Resultados de Calidad')).toBeInTheDocument();
    });
    expect(screen.getByText('Total Reglas')).toBeInTheDocument();
    expect(screen.getAllByText('Pasaron').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Fallaron').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/90\.0%/)).toBeInTheDocument();
  });

  it('muestra sección de estado de remediación', async () => {
    getMockService().getDashboardData.mockResolvedValue(mockDashboardData);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Estado de Remediación')).toBeInTheDocument();
    });
    expect(screen.getByText('Propuestas')).toBeInTheDocument();
    expect(screen.getByText('Pendientes')).toBeInTheDocument();
    expect(screen.getByText('Aprobadas')).toBeInTheDocument();
    expect(screen.getByText('Rechazadas')).toBeInTheDocument();
    expect(screen.getByText('XML Generados')).toBeInTheDocument();
  });

  it('muestra tabla de calidad por dataset', async () => {
    getMockService().getDashboardData.mockResolvedValue(mockDashboardData);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('upload-abc')).toBeInTheDocument();
    });
    expect(screen.getByText('Geopos Local')).toBeInTheDocument();
  });

  it('muestra mensaje cuando no hay discrepancias por etapa', async () => {
    const dataNoDisc: DashboardData = {
      ...mockDashboardData,
      stageDiscrepancies: [],
    };
    getMockService().getDashboardData.mockResolvedValue(dataNoDisc);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('No hay discrepancias registradas.')).toBeInTheDocument();
    });
  });
});
