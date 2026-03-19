import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileUploadForm, { STAGE_DISPLAY_NAMES } from './FileUploadForm';

// Mock useAuth
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', email: 'test@example.com', role: 'Operator' },
    role: 'Operator',
    loading: false,
    isAuthenticated: true,
    hasPermission: () => true,
    hasRole: () => true,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

// Mock uploadService
const mockValidateFile = vi.fn();
const mockUploadFile = vi.fn();
vi.mock('../../services/upload', () => ({
  uploadService: {
    validateFile: (...args: unknown[]) => mockValidateFile(...args),
    uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  },
}));

describe('FileUploadForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders stage selector with all 4 cascade stages', async () => {
    render(<FileUploadForm />);
    expect(screen.getByLabelText('Etapa de la Cascada')).toBeInTheDocument();

    // Open the select
    await userEvent.click(screen.getByLabelText('Etapa de la Cascada'));

    for (const name of Object.values(STAGE_DISPLAY_NAMES)) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('renders the file drop zone', () => {
    render(<FileUploadForm />);
    expect(screen.getByText('Arrastra un archivo CSV aquí')).toBeInTheDocument();
  });

  it('upload button is disabled when no file or stage is selected', () => {
    render(<FileUploadForm />);
    expect(screen.getByRole('button', { name: /cargar archivo/i })).toBeDisabled();
  });

  it('shows validation errors when file validation fails', async () => {
    mockValidateFile.mockReturnValue({
      isValid: false,
      errors: [
        { type: 'missing_column', message: 'Columna requerida faltante: total' },
      ],
    });

    render(<FileUploadForm />);

    // Select stage
    await userEvent.click(screen.getByLabelText('Etapa de la Cascada'));
    await userEvent.click(screen.getByText('Geopos Local'));

    // Select file via input
    const file = new File(['bad,headers\n1,2'], 'test.csv', { type: 'text/csv' });
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Click upload
    await userEvent.click(screen.getByRole('button', { name: /cargar archivo/i }));

    await waitFor(() => {
      expect(screen.getByText('Columna requerida faltante: total')).toBeInTheDocument();
    });
  });

  it('shows success message after successful upload', async () => {
    mockValidateFile.mockReturnValue({ isValid: true, errors: [] });
    mockUploadFile.mockResolvedValue({
      uploadId: 'upload-123',
      s3Key: 'uploads/test.csv',
      stage: 'geopos_local',
      status: 'success',
      catalogEntryId: 'cat-123',
      timestamp: new Date().toISOString(),
    });

    const onComplete = vi.fn();
    render(<FileUploadForm onUploadComplete={onComplete} />);

    // Select stage
    await userEvent.click(screen.getByLabelText('Etapa de la Cascada'));
    await userEvent.click(screen.getByText('Geopos Local'));

    // Select file
    const file = new File(['invoice,total,barcode,description\n1,100,abc,desc'], 'ok.csv', { type: 'text/csv' });
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Upload
    await userEvent.click(screen.getByRole('button', { name: /cargar archivo/i }));

    await waitFor(() => {
      expect(screen.getByText(/cargado exitosamente/i)).toBeInTheDocument();
    });
    expect(onComplete).toHaveBeenCalled();
  });

  it('has correct stage display names', () => {
    expect(STAGE_DISPLAY_NAMES.geopos_local).toBe('Geopos Local');
    expect(STAGE_DISPLAY_NAMES.geopos_central).toBe('Geopos Central');
    expect(STAGE_DISPLAY_NAMES.integracion).toBe('Integración');
    expect(STAGE_DISPLAY_NAMES.ps_ck_intfc_vtapos).toBe('PS_CK_INTFC_VTAPOS');
  });
});
