/**
 * UploadHistory — table showing upload records with file name, stage,
 * status (colored chips), uploaded by, date, pagination, and stage filter.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  CircularProgress,
} from '@mui/material';
import type { CascadeStage } from '../../types/csv';
import type { UploadRecord, UploadStatus } from '../../types/upload';
import { uploadService } from '../../services/upload';
import { STAGE_DISPLAY_NAMES } from './FileUploadForm';

/** Color mapping for upload status chips. */
const STATUS_CONFIG: Record<UploadStatus, { label: string; color: 'success' | 'info' | 'warning' | 'error' | 'default' }> = {
  uploaded: { label: 'Cargado', color: 'info' },
  processing: { label: 'Procesando', color: 'warning' },
  transformed: { label: 'Transformado', color: 'success' },
  compared: { label: 'Comparado', color: 'success' },
  error: { label: 'Error', color: 'error' },
};

const STAGES = Object.keys(STAGE_DISPLAY_NAMES) as CascadeStage[];

export interface UploadHistoryProps {
  /** Increment this value to trigger a refresh of the history. */
  refreshTrigger?: number;
}

export default function UploadHistory({ refreshTrigger = 0 }: UploadHistoryProps) {
  const [records, setRecords] = useState<UploadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<CascadeStage | ''>('');
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchHistory = useCallback(
    async (token?: string | null) => {
      const isLoadMore = !!token;
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await uploadService.getUploadHistory(
          stageFilter ? { stage: stageFilter } : undefined,
          token,
        );

        if (isLoadMore) {
          setRecords((prev) => [...prev, ...result.items]);
        } else {
          setRecords(result.items);
        }
        setNextToken(result.nextToken ?? null);
      } catch {
        // Silently handle — records stay empty
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [stageFilter],
  );

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, refreshTrigger]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h6">Historial de Cargas</Typography>

        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="history-stage-filter-label">Filtrar por etapa</InputLabel>
          <Select
            labelId="history-stage-filter-label"
            value={stageFilter}
            label="Filtrar por etapa"
            onChange={(e) => setStageFilter(e.target.value as CascadeStage | '')}
          >
            <MenuItem value="">Todas las etapas</MenuItem>
            {STAGES.map((s) => (
              <MenuItem key={s} value={s}>
                {STAGE_DISPLAY_NAMES[s]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }} role="status" aria-label="Cargando historial">
          <CircularProgress aria-label="Cargando historial de cargas" />
        </Box>
      ) : records.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          No hay cargas registradas.
        </Typography>
      ) : (
        <>
          <TableContainer>
            <Table size="small" aria-label="Historial de cargas de archivos">
              <TableHead>
                <TableRow>
                  <TableCell>Archivo</TableCell>
                  <TableCell>Etapa</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Cargado por</TableCell>
                  <TableCell>Fecha</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map((record) => {
                  const statusCfg = STATUS_CONFIG[record.status];
                  return (
                    <TableRow key={record.uploadId}>
                      <TableCell>{record.fileName}</TableCell>
                      <TableCell>
                        {STAGE_DISPLAY_NAMES[record.stage] ?? record.stage}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={statusCfg?.label ?? record.status}
                          color={statusCfg?.color ?? 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{record.uploadedBy}</TableCell>
                      <TableCell>{formatDate(record.uploadedAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {nextToken && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Button
                variant="outlined"
                onClick={() => fetchHistory(nextToken)}
                disabled={loadingMore}
                startIcon={loadingMore ? <CircularProgress size={16} /> : undefined}
                aria-label="Cargar más registros del historial"
              >
                {loadingMore ? 'Cargando...' : 'Cargar más'}
              </Button>
            </Box>
          )}
        </>
      )}
    </Paper>
  );
}
