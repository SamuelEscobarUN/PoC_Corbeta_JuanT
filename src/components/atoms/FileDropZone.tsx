/**
 * FileDropZone — reusable drag-and-drop component for CSV file selection.
 *
 * Accepts only .csv files. Provides visual feedback during drag-over
 * and displays the selected file name after selection.
 */
import { useState, useCallback, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

export interface FileDropZoneProps {
  /** Called when a valid CSV file is selected or dropped. */
  onFileSelect: (file: File) => void;
  /** Whether the drop zone is disabled. */
  disabled?: boolean;
  /** Currently selected file (controlled). */
  selectedFile?: File | null;
}

export default function FileDropZone({
  onFileSelect,
  disabled = false,
  selectedFile = null,
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        onFileSelect(file);
      }
    },
    [disabled, onFileSelect],
  );

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  return (
    <Box
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Zona de carga de archivos CSV"
      aria-disabled={disabled}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{
        border: '2px dashed',
        borderColor: isDragOver
          ? 'secondary.main'
          : selectedFile
            ? 'primary.main'
            : 'grey.400',
        borderRadius: 2,
        p: 4,
        textAlign: 'center',
        cursor: disabled ? 'default' : 'pointer',
        bgcolor: isDragOver
          ? 'action.hover'
          : selectedFile
            ? 'primary.50'
            : 'background.paper',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.2s ease',
        '&:hover': disabled
          ? {}
          : { borderColor: 'primary.main', bgcolor: 'action.hover' },
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        hidden
        onChange={handleInputChange}
        data-testid="file-input"
        aria-label="Seleccionar archivo CSV"
      />
      {selectedFile ? (
        <>
          <InsertDriveFileIcon
            sx={{ fontSize: 48, color: 'primary.main', mb: 1 }}
          />
          <Typography variant="body1" fontWeight={500}>
            {selectedFile.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {(selectedFile.size / 1024).toFixed(1)} KB — Clic para cambiar
          </Typography>
        </>
      ) : (
        <>
          <CloudUploadIcon
            sx={{ fontSize: 48, color: 'grey.500', mb: 1 }}
          />
          <Typography variant="body1" fontWeight={500}>
            Arrastra un archivo CSV aquí
          </Typography>
          <Typography variant="body2" color="text.secondary">
            o haz clic para seleccionar
          </Typography>
        </>
      )}
    </Box>
  );
}
