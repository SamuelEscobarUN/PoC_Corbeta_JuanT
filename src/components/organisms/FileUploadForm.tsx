/**
 * FileUploadForm — form with cascade stage selector, drag-and-drop CSV zone,
 * validation error display, and upload progress feedback.
 */
import { useState, useCallback } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Alert,
  CircularProgress,
  Paper,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import type { CascadeStage, ValidationError } from '../../types/csv';
import type { UploadResult } from '../../types/upload';
import { uploadService } from '../../services/upload';
import { useAuth } from '../../hooks/useAuth';
import FileDropZone from '../atoms/FileDropZone';

/** Human-readable display names for each cascade stage. */
export const STAGE_DISPLAY_NAMES: Record<CascadeStage, string> = {
  geopos_local: 'Geopos Local',
  geopos_central: 'Geopos Central',
  integracion: 'Integración',
  ps_ck_intfc_vtapos: 'PS_CK_INTFC_VTAPOS',
};

const STAGES = Object.keys(STAGE_DISPLAY_NAMES) as CascadeStage[];

export interface FileUploadFormProps {
  /** Called after a successful upload so the parent can refresh history. */
  onUploadComplete?: (result: UploadResult) => void;
  /** Optional session ID to associate uploads with a work session. */
  sessionId?: string;
  /** Called before upload starts. Can return a sessionId to use for this upload. */
  onBeforeUpload?: () => Promise<string | undefined>;
}

/** Delimiter options for CSV parsing. */
const DELIMITER_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto-detectar' },
  { value: ',', label: 'Coma (,)' },
  { value: '\t', label: 'Tabulador (Tab)' },
  { value: ';', label: 'Punto y coma (;)' },
  { value: '|', label: 'Pipe (|)' },
];

export default function FileUploadForm({ onUploadComplete, sessionId, onBeforeUpload }: FileUploadFormProps) {
  const { user } = useAuth();
  const [stage, setStage] = useState<CascadeStage | ''>('');
  const [delimiter, setDelimiter] = useState('auto');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const handleFileSelect = useCallback((selected: File) => {
    setFile(selected);
    setErrors([]);
    setUploadResult(null);
  }, []);

  const handleUpload = async () => {
    if (!file || !stage || !user) return;

    setErrors([]);
    setUploadResult(null);
    setUploading(true);

    try {
      // Read file content for validation
      const content = await file.text();

      // Client-side validation first
      const delim = delimiter === 'auto' ? undefined : delimiter;
      const validation = uploadService.validateFile(content, stage, delim);
      if (!validation.isValid) {
        setErrors(validation.errors);
        setUploading(false);
        return;
      }

      // Upload
      const resolvedSessionId = onBeforeUpload ? await onBeforeUpload() : sessionId;
      const result = await uploadService.uploadFile(file, stage, content, user.userId, resolvedSessionId);
      setUploadResult(result);

      if (result.status === 'success') {
        setFile(null);
        setStage('');
        onUploadComplete?.(result);
      }
    } catch {
      setErrors([
        {
          type: 'invalid_format',
          message: 'Error inesperado al cargar el archivo. Intente nuevamente.',
        },
      ]);
    } finally {
      setUploading(false);
    }
  };

  const canUpload = !!file && !!stage && !uploading;

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Cargar Archivo CSV
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* Stage selector */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl sx={{ flex: 2 }}>
            <InputLabel id="stage-select-label">Etapa de la Cascada</InputLabel>
            <Select
              labelId="stage-select-label"
              id="stage-select"
              value={stage}
              label="Etapa de la Cascada"
              onChange={(e) => {
                setStage(e.target.value as CascadeStage);
                setErrors([]);
                setUploadResult(null);
              }}
              disabled={uploading}
            >
              {STAGES.map((s) => (
                <MenuItem key={s} value={s}>
                  {STAGE_DISPLAY_NAMES[s]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ flex: 1 }}>
            <InputLabel id="delimiter-select-label">Separador</InputLabel>
            <Select
              labelId="delimiter-select-label"
              id="delimiter-select"
              value={delimiter}
              label="Separador"
              onChange={(e) => setDelimiter(e.target.value)}
              disabled={uploading}
            >
              {DELIMITER_OPTIONS.map((d) => (
                <MenuItem key={d.value} value={d.value}>
                  {d.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {/* Drag-and-drop zone */}
        <FileDropZone
          onFileSelect={handleFileSelect}
          disabled={uploading}
          selectedFile={file}
        />

        {/* Errores de validación — región aria-live para anunciar errores */}
        {errors.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} role="alert" aria-live="assertive">
            {errors.map((err, i) => (
              <Alert key={i} severity="error" variant="outlined">
                {err.message}
                {err.details && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {err.details}
                  </Typography>
                )}
              </Alert>
            ))}
          </Box>
        )}

        {/* Mensaje de éxito */}
        {uploadResult?.status === 'success' && (
          <Alert severity="success" role="status" aria-live="polite">
            Archivo cargado exitosamente. ID: {uploadResult.uploadId}
          </Alert>
        )}

        {uploadResult?.status === 'failed' && errors.length === 0 && (
          <Alert severity="error" role="alert" aria-live="assertive">
            Error al cargar el archivo. Intente nuevamente.
          </Alert>
        )}

        {/* Upload button */}
        <Button
          variant="contained"
          size="large"
          startIcon={
            uploading ? <CircularProgress size={20} color="inherit" /> : <UploadFileIcon />
          }
          onClick={handleUpload}
          disabled={!canUpload}
          aria-label="Cargar archivo"
        >
          {uploading ? 'Cargando...' : 'Cargar Archivo'}
        </Button>
      </Box>
    </Paper>
  );
}
