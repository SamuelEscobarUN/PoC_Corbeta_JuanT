import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemediationPage from './RemediationPage';
import type { Finding } from '../../types/ai-analysis';
import type { Correction } from '../../types/remediation';

// Mock useAuth
const mockRole = vi.fn<() => string | null>(() => 'Administrator');
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { email: 'admin@test.com' },
    role: mockRole(),
    signOut: vi.fn(),
  }),
}));

// Mock servicios
const mockGetCorrections = vi.fn();
const mockProposeCorrection = vi.fn();
const mockApproveCorrection = vi.fn();
const mockRejectCorrection = vi.fn();
const mockGetFindings = vi.fn();
const mockGenerateCorrectionXml = vi.fn();

vi.mock('../../services/remediation', () => ({
  RemediationService: {
    getInstance: () => ({
      getCorrections: mockGetCorrections,
      proposeCorrection: mockProposeCorrection,
      approveCorrection: mockApproveCorrection,
      rejectCorrection: mockRejectCorrection,
    }),
  },
}));

vi.mock('../../services/ai-analysis', () => ({
  AIAnalysisService: {
    getInstance: () => ({
      getFindings: mockGetFindings,
    }),
  },
}));

vi.mock('../../services/xml-generator', () => ({
  XmlGeneratorService: class {
    generateCorrectionXml = mockGenerateCorrectionXml;
  },
}));

vi.mock('../../services/session', () => ({
  sessionService: {
    listSessions: vi.fn().mockResolvedValue({ items: [], nextToken: null }),
  },
}));

/** Datos de prueba */
const mockFindings: Finding[] = [
  {
    findingId: 'f-001-abcd-1234',
    discrepancyId: 'd-001',
    explanation: 'Factura faltante en Geopos Central',
    probableCause: 'Error de sincronización',
    recommendation: 'Verificar registros de sincronización',
    severity: 'high',
    itemFindings: [
      { itemId: 'ITEM-01', explanation: 'Ítem no encontrado en destino', suggestedAction: 'Revisar' },
    ],
    createdAt: '2024-01-15T10:00:00Z',
  },
];

const mockCorrections: Correction[] = [
  {
    correctionId: 'c-001-abcd-1234',
    discrepancyId: 'd-001',
    findingId: 'f-001',
    invoice: 'INV-100',
    item: 'SKU-50',
    originStage: 'geopos_local',
    correctedValues: { total: 1500 },
    status: 'pending_approval',
    proposedBy: 'operador1',
    proposedAt: '2024-01-16T10:00:00Z',
    createdAt: '2024-01-16T10:00:00Z',
    updatedAt: '2024-01-16T10:00:00Z',
  },
  {
    correctionId: 'c-002-efgh-5678',
    discrepancyId: 'd-002',
    findingId: 'f-002',
    invoice: 'INV-200',
    originStage: 'integracion',
    correctedValues: { total: 2000 },
    status: 'approved',
    proposedBy: 'operador2',
    proposedAt: '2024-01-17T10:00:00Z',
    approvedBy: 'admin1',
    reviewedAt: '2024-01-18T10:00:00Z',
    createdAt: '2024-01-17T10:00:00Z',
    updatedAt: '2024-01-18T10:00:00Z',
  },
  {
    correctionId: 'c-003-ijkl-9012',
    discrepancyId: 'd-003',
    findingId: 'f-003',
    invoice: 'INV-300',
    originStage: 'ps_ck_intfc_vtapos',
    correctedValues: {},
    status: 'rejected',
    proposedBy: 'operador3',
    proposedAt: '2024-01-19T10:00:00Z',
    rejectedBy: 'admin1',
    rejectionReason: 'Datos incorrectos',
    reviewedAt: '2024-01-20T10:00:00Z',
    createdAt: '2024-01-19T10:00:00Z',
    updatedAt: '2024-01-20T10:00:00Z',
  },
];

describe('RemediationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole.mockReturnValue('Administrator');
    mockGetCorrections.mockResolvedValue({ items: mockCorrections, total: 3 });
    mockGetFindings.mockResolvedValue(mockFindings);
    mockGenerateCorrectionXml.mockReturnValue('<correction></correction>');
  });

  it('muestra estado de carga inicialmente', () => {
    mockGetCorrections.mockReturnValue(new Promise(() => {}));
    mockGetFindings.mockReturnValue(new Promise(() => {}));
    render(<RemediationPage />);
    expect(screen.getByRole('status', { name: /cargando/i })).toBeInTheDocument();
  });

  it('muestra error cuando falla la carga', async () => {
    mockGetCorrections.mockRejectedValue(new Error('fail'));
    mockGetFindings.mockRejectedValue(new Error('fail'));
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('No se pudieron cargar los datos de remediación.')).toBeInTheDocument();
    });
  });

  it('muestra título y pestañas', async () => {
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /hallazgos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /correcciones/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /xml generados/i })).toBeInTheDocument();
  });

  it('muestra hallazgos con explicación, causa y recomendación', async () => {
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText(/Factura faltante en Geopos Central/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Error de sincronización/)).toBeInTheDocument();
    expect(screen.getByText(/Verificar registros de sincronización/)).toBeInTheDocument();
  });

  it('muestra detalle por ítem en hallazgos', async () => {
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText(/ITEM-01/)).toBeInTheDocument();
    });
  });

  it('muestra botón proponer corrección en hallazgos', async () => {
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Proponer corrección')).toBeInTheDocument();
    });
  });

  it('muestra mensaje cuando no hay hallazgos', async () => {
    mockGetFindings.mockResolvedValue([]);
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('No hay hallazgos registrados.')).toBeInTheDocument();
    });
  });

  it('navega a pestaña correcciones y muestra tabla', async () => {
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /correcciones/i }));
    expect(screen.getByText('INV-100')).toBeInTheDocument();
    expect(screen.getByText('INV-200')).toBeInTheDocument();
    expect(screen.getByText('INV-300')).toBeInTheDocument();
  });

  it('muestra chips de estado en correcciones', async () => {
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /correcciones/i }));
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('Aprobada')).toBeInTheDocument();
    expect(screen.getByText('Rechazada')).toBeInTheDocument();
  });

  it('muestra botones aprobar/rechazar solo para admin en correcciones pendientes', async () => {
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /correcciones/i }));
    expect(screen.getByLabelText('Aprobar corrección')).toBeInTheDocument();
    expect(screen.getByLabelText('Rechazar corrección')).toBeInTheDocument();
  });

  it('no muestra columna acciones para operador', async () => {
    mockRole.mockReturnValue('Operator');
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /correcciones/i }));
    expect(screen.queryByText('Acciones')).not.toBeInTheDocument();
  });

  it('abre diálogo de rechazo con campo de motivo', async () => {
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /correcciones/i }));
    await user.click(screen.getByLabelText('Rechazar corrección'));
    expect(screen.getByText('Rechazar corrección', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByLabelText(/motivo de rechazo/i)).toBeInTheDocument();
  });

  it('botón rechazar deshabilitado sin motivo', async () => {
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /correcciones/i }));
    await user.click(screen.getByLabelText('Rechazar corrección'));
    const dialog = screen.getByRole('dialog');
    const rejectBtn = within(dialog).getByRole('button', { name: /rechazar/i });
    expect(rejectBtn).toBeDisabled();
  });

  it('navega a pestaña XML y muestra correcciones aprobadas', async () => {
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /xml generados/i }));
    expect(screen.getByText('INV-200')).toBeInTheDocument();
    expect(screen.getByLabelText('Descargar XML de corrección')).toBeInTheDocument();
  });

  it('muestra mensaje cuando no hay XML generados', async () => {
    mockGetCorrections.mockResolvedValue({ items: [mockCorrections[0]], total: 1 });
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /xml generados/i }));
    expect(screen.getByText('No hay XML de corrección generados.')).toBeInTheDocument();
  });

  it('abre diálogo de proponer corrección al hacer clic', async () => {
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Proponer corrección')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Proponer corrección'));
    expect(screen.getByText('Proponer corrección', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByLabelText(/ítem afectado/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/valores corregidos/i)).toBeInTheDocument();
  });

  it('muestra motivo de rechazo en correcciones rechazadas', async () => {
    const user = userEvent.setup();
    render(<RemediationPage />);
    await waitFor(() => {
      expect(screen.getByText('Remediación')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /correcciones/i }));
    expect(screen.getByText(/Datos incorrectos/)).toBeInTheDocument();
  });
});
