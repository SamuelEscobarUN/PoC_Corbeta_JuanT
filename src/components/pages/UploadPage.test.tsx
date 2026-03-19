import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UploadPage from './UploadPage';

// Mock child components to isolate page-level tests
vi.mock('../organisms/FileUploadForm', () => ({
  default: () => <div data-testid="file-upload-form">FileUploadForm</div>,
}));

vi.mock('../organisms/UploadHistory', () => ({
  default: ({ refreshTrigger }: { refreshTrigger: number }) => (
    <div data-testid="upload-history">UploadHistory trigger={refreshTrigger}</div>
  ),
}));

describe('UploadPage', () => {
  it('renders the page title', () => {
    render(<UploadPage />);
    expect(screen.getByText('Carga de Archivos')).toBeInTheDocument();
  });

  it('renders the upload form and history components', () => {
    render(<UploadPage />);
    expect(screen.getByTestId('file-upload-form')).toBeInTheDocument();
    expect(screen.getByTestId('upload-history')).toBeInTheDocument();
  });
});
