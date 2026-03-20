/**
 * SessionsPage — Listado de sesiones de trabajo.
 *
 * Muestra una tabla con todas las sesiones pasadas, con filtros por estado
 * y búsqueda por nombre. Clic en una fila navega al detalle de la sesión.
 *
 * Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';
import { sessionService } from '../../services/session';
import type { Session, SessionStatus } from '../../types/session';

const STATUS_LABELS: Record<SessionStatus, string> = {
  in_progress: 'En progreso',
  completed: 'Completada',
  archived: 'Archivada',
};

const STATUS_COLORS: Record<SessionStatus, 'warning' | 'success' | 'default'> = {
  in_progress: 'warning',
  completed: 'success',
  archived: 'default',
};

export default function SessionsPage() {
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SessionStatus | ''>('');
  const [searchQuery, setSearchQuery] = useState('');

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: { status?: SessionStatus; searchQuery?: string } = {};
      if (statusFilter) filters.status = statusFilter;
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim();
      const { items } = await sessionService.listSessions(filters);
      setSessions(items);
    } catch {
      setError('Error al cargar las sesiones.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await sessionService.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch {
      setError('Error al eliminar la sesión.');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5">Sesiones de Trabajo</Typography>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Filtros */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Buscar por nombre..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> } }}
            sx={{ minWidth: 250 }}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Estado</InputLabel>
            <Select
              value={statusFilter}
              label="Estado"
              onChange={(e) => setStatusFilter(e.target.value as SessionStatus | '')}
            >
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="in_progress">En progreso</MenuItem>
              <MenuItem value="completed">Completada</MenuItem>
              <MenuItem value="archived">Archivada</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="body2" color="text.secondary">
            {sessions.length} sesiones
          </Typography>
        </Box>
      </Paper>

      {/* Tabla */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : sessions.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No se encontraron sesiones. Las sesiones se crean al ejecutar una comparación en la página de Discrepancias.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Nombre</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Fecha de Creación</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Estado</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Usuario</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }} align="right"># Discrepancias</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }} align="right"># Hallazgos</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }} align="center">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sessions.map((session) => (
                <TableRow
                  key={session.sessionId}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/sessions/${session.sessionId}`)}
                >
                  <TableCell>{session.sessionName}</TableCell>
                  <TableCell>
                    {new Date(session.createdAt).toLocaleDateString('es-CO', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={STATUS_LABELS[session.status]}
                      size="small"
                      color={STATUS_COLORS[session.status]}
                    />
                  </TableCell>
                  <TableCell>{session.createdBy}</TableCell>
                  <TableCell align="right">{session.discrepancyCount ?? 0}</TableCell>
                  <TableCell align="right">{session.findingCount ?? 0}</TableCell>
                  <TableCell align="center">
                    <Tooltip title="Eliminar sesión" arrow>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => handleDelete(e, session.sessionId)}
                        aria-label={`Eliminar sesión ${session.sessionName}`}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
