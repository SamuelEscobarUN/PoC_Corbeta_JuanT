import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileDropZone from './FileDropZone';

function csvFile(name = 'test.csv') {
  return new File(['col1,col2\na,b'], name, { type: 'text/csv' });
}

describe('FileDropZone', () => {
  it('renders default prompt when no file is selected', () => {
    render(<FileDropZone onFileSelect={vi.fn()} />);
    expect(screen.getByText('Arrastra un archivo CSV aquí')).toBeInTheDocument();
    expect(screen.getByText('o haz clic para seleccionar')).toBeInTheDocument();
  });

  it('shows selected file name and size', () => {
    const file = csvFile('ventas.csv');
    render(<FileDropZone onFileSelect={vi.fn()} selectedFile={file} />);
    expect(screen.getByText('ventas.csv')).toBeInTheDocument();
  });

  it('calls onFileSelect when a file is chosen via input', () => {
    const onFileSelect = vi.fn();
    render(<FileDropZone onFileSelect={onFileSelect} />);

    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = csvFile();
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  it('calls onFileSelect on drop of a .csv file', () => {
    const onFileSelect = vi.fn();
    render(<FileDropZone onFileSelect={onFileSelect} />);

    const zone = screen.getByRole('button');
    const file = csvFile('drop.csv');

    fireEvent.drop(zone, {
      dataTransfer: { files: [file] },
    });

    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  it('ignores non-csv files on drop', () => {
    const onFileSelect = vi.fn();
    render(<FileDropZone onFileSelect={onFileSelect} />);

    const zone = screen.getByRole('button');
    const file = new File(['data'], 'test.txt', { type: 'text/plain' });

    fireEvent.drop(zone, {
      dataTransfer: { files: [file] },
    });

    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('does not respond to interactions when disabled', () => {
    const onFileSelect = vi.fn();
    render(<FileDropZone onFileSelect={onFileSelect} disabled />);

    const zone = screen.getByRole('button');
    const file = csvFile();

    fireEvent.drop(zone, {
      dataTransfer: { files: [file] },
    });

    expect(onFileSelect).not.toHaveBeenCalled();
  });
});
