import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadHistory from './UploadHistory';
import type { UploadRecord } from '../../types/upload';

const mockGetUploadHistory = vi.fn();
vi.mock('../../services/upload', () => ({
  uploadService: {
    getUploadHistory: (...args: unknown[]) => mockGetUploadHistory(...args),
  },
}));

// Re-export STAGE_DISPLAY_NAMES used by UploadHistory
vi.mock('./FileUploadForm', () => ({
  STAGE_DISPLAY_NAMES: {
    geopos_local: 'Geopos Local',
    geopos_central: 'Geopos Central',
    integracion: 'Integración',
    ps_ck_intfc_vtapos: 'PS_CK_INTFC_VTAPOS',
  },
}));

const sampleRecords: UploadRecord[] = [
  {
    uploadId: 'u1',
    stage: 'geopos_local',
    fileName: 'ventas.csv',
    fileSize: 1024,
    status: 'uploaded',
    s3Key: 'uploads/geopos_local/2024/01/01/u1/raw.csv',
    uploadedBy: 'user@test.com',
    uploadedAt: '2024-06-15T10:30:00Z',
  },
  {
    uploadId: 'u2',
    stage: 'integracion',
    fileName: 'integ.csv',
    fileSize: 2048,
    status: 'error',
    s3Key: 'uploads/integracion/2024/01/01/u2/raw.csv',
    uploadedBy: 'admin@test.com',
    uploadedAt: '2024-06-14T08:00:00Z',
    errorMessage: 'Missing columns',
  },
];

describe('UploadHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockGetUploadHistory.mockReturnValue(new Promise(() => {})); // never resolves
    render(<UploadHistory />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows empty message when no records', async () => {
    mockGetUploadHistory.mockResolvedValue({ items: [], nextToken: null });
    render(<UploadHistory />);

    await waitFor(() => {
      expect(screen.getByText('No hay cargas registradas.')).toBeInTheDocument();
    });
  });

  it('renders upload records in a table', async () => {
    mockGetUploadHistory.mockResolvedValue({ items: sampleRecords, nextToken: null });
    render(<UploadHistory />);

    await waitFor(() => {
      expect(screen.getByText('ventas.csv')).toBeInTheDocument();
    });
    expect(screen.getByText('integ.csv')).toBeInTheDocument();
    expect(screen.getByText('Geopos Local')).toBeInTheDocument();
    expect(screen.getByText('Integración')).toBeInTheDocument();
    expect(screen.getByText('Cargado')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('shows "Cargar más" button when nextToken exists', async () => {
    mockGetUploadHistory.mockResolvedValue({ items: sampleRecords, nextToken: 'tok-1' });
    render(<UploadHistory />);

    await waitFor(() => {
      expect(screen.getByText('Cargar más')).toBeInTheDocument();
    });
  });

  it('has a stage filter dropdown', async () => {
    mockGetUploadHistory.mockResolvedValue({ items: [], nextToken: null });
    render(<UploadHistory />);

    await waitFor(() => {
      expect(screen.getByLabelText('Filtrar por etapa')).toBeInTheDocument();
    });
  });

  it('refetches when refreshTrigger changes', async () => {
    mockGetUploadHistory.mockResolvedValue({ items: [], nextToken: null });
    const { rerender } = render(<UploadHistory refreshTrigger={0} />);

    await waitFor(() => {
      expect(mockGetUploadHistory).toHaveBeenCalledTimes(1);
    });

    rerender(<UploadHistory refreshTrigger={1} />);

    await waitFor(() => {
      expect(mockGetUploadHistory).toHaveBeenCalledTimes(2);
    });
  });

  it('filters by stage when a stage is selected', async () => {
    mockGetUploadHistory.mockResolvedValue({ items: [], nextToken: null });
    render(<UploadHistory />);

    await waitFor(() => {
      expect(mockGetUploadHistory).toHaveBeenCalledTimes(1);
    });

    // Open filter dropdown and select a stage
    await userEvent.click(screen.getByLabelText('Filtrar por etapa'));
    await userEvent.click(screen.getByText('Geopos Central'));

    await waitFor(() => {
      expect(mockGetUploadHistory).toHaveBeenCalledWith(
        { stage: 'geopos_central' },
        undefined,
      );
    });
  });
});
