/**
 * AdminPage — panel de administración con 4 pestañas:
 * 1. Gestión de Usuarios (CRUD)
 * 2. Asignación de Roles y Permisos
 * 3. Configuración del Sistema
 * 4. Supervisión de estado
 *
 * Requisitos: 10.1, 10.2, 10.3, 10.4, 11.4
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Alert,
  Card,
  CardContent,
  Grid,
  Switch,
  FormControlLabel,
  Slider,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import BlockIcon from '@mui/icons-material/Block';
import { UserManagementService } from '../../services/user-management';
import { DashboardService } from '../../services/dashboard';
import type { UserProfile, UserRole } from '../../types/auth';
import { Permissions, RolePermissions } from '../../types/auth';
import type { CreateUserInput, UpdateUserInput } from '../../types/user-management';
import type { DashboardData } from '../../types/dashboard';

/* ------------------------------------------------------------------ */
/*  Tab panel helper                                                   */
/* ------------------------------------------------------------------ */
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index} id={`admin-tabpanel-${index}`} aria-labelledby={`admin-tab-${index}`}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  User form dialog                                                   */
/* ------------------------------------------------------------------ */
interface UserFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateUserInput | (UpdateUserInput & { userId: string })) => void;
  user?: UserProfile | null;
  loading?: boolean;
}

function UserFormDialog({ open, onClose, onSubmit, user, loading }: UserFormDialogProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('Operator');

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setName('');
      setRole(user.role);
    } else {
      setEmail('');
      setName('');
      setRole('Operator');
    }
  }, [user, open]);

  const handleSubmit = () => {
    if (user) {
      onSubmit({ userId: user.userId, email, name: name || undefined, role });
    } else {
      onSubmit({ email, name: name || undefined, role });
    }
  };

  const isEdit = !!user;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Editar Usuario' : 'Crear Usuario'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            type="email"
          />
          <TextField
            label="Nombre (opcional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel id="role-select-label">Rol</InputLabel>
            <Select
              labelId="role-select-label"
              value={role}
              label="Rol"
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <MenuItem value="Administrator">Administrador</MenuItem>
              <MenuItem value="Operator">Operador</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!email || loading}>
          {loading ? <CircularProgress size={20} /> : isEdit ? 'Guardar' : 'Crear'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}


/* ------------------------------------------------------------------ */
/*  Tab 1: Gestión de Usuarios                                        */
/* ------------------------------------------------------------------ */
interface UserManagementTabProps {
  users: UserProfile[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreateUser: (data: CreateUserInput) => Promise<void>;
  onUpdateUser: (userId: string, data: UpdateUserInput) => Promise<void>;
  onDeactivateUser: (userId: string) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
}

function UserManagementTab({
  users,
  loading,
  error,
  onRefresh,
  onCreateUser,
  onUpdateUser,
  onDeactivateUser,
  onDeleteUser,
}: UserManagementTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleOpenCreate = () => {
    setEditingUser(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (user: UserProfile) => {
    setEditingUser(user);
    setDialogOpen(true);
  };

  const handleSubmit = async (data: CreateUserInput | (UpdateUserInput & { userId: string })) => {
    setActionLoading(true);
    try {
      if ('userId' in data) {
        const { userId, ...updateData } = data;
        await onUpdateUser(userId, updateData);
      } else {
        await onCreateUser(data);
      }
      setDialogOpen(false);
      onRefresh();
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivate = async (userId: string) => {
    setActionLoading(true);
    try {
      await onDeactivateUser(userId);
      onRefresh();
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (userId: string) => {
    setActionLoading(true);
    try {
      await onDeleteUser(userId);
      onRefresh();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Usuarios del Sistema</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Crear Usuario
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress aria-label="Cargando usuarios" />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table aria-label="Tabla de usuarios">
            <TableHead>
              <TableRow>
                <TableCell>Correo</TableCell>
                <TableCell>Rol</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    No hay usuarios registrados.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.userId}>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Chip
                        label={user.role === 'Administrator' ? 'Administrador' : 'Operador'}
                        color={user.role === 'Administrator' ? 'secondary' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={user.isActive ? 'Activo' : 'Inactivo'}
                        color={user.isActive ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Editar">
                        <IconButton size="small" onClick={() => handleOpenEdit(user)} aria-label={`Editar ${user.email}`}>
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Desactivar">
                        <IconButton size="small" onClick={() => handleDeactivate(user.userId)} aria-label={`Desactivar ${user.email}`} disabled={!user.isActive || actionLoading}>
                          <BlockIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Eliminar">
                        <IconButton size="small" color="error" onClick={() => handleDelete(user.userId)} aria-label={`Eliminar ${user.email}`} disabled={actionLoading}>
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <UserFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
        user={editingUser}
        loading={actionLoading}
      />
    </Box>
  );
}


/* ------------------------------------------------------------------ */
/*  Tab 2: Asignación de Roles y Permisos                             */
/* ------------------------------------------------------------------ */
interface RoleAssignmentTabProps {
  users: UserProfile[];
  onAssignRole: (userId: string, role: UserRole, permissions: string[]) => Promise<void>;
}

function RoleAssignmentTab({ users, onAssignRole }: RoleAssignmentTabProps) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('Operator');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const allPermissions = Object.values(Permissions) as string[];

  useEffect(() => {
    const perms = RolePermissions[selectedRole] as string[];
    setSelectedPermissions([...perms]);
  }, [selectedRole]);

  const handleTogglePermission = (perm: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  };

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setSuccess(false);
    try {
      await onAssignRole(selectedUserId, selectedRole, selectedPermissions);
      setSuccess(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Asignación de Rol y Permisos</Typography>

      {success && <Alert severity="success" sx={{ mb: 2 }}>Rol y permisos asignados correctamente.</Alert>}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 500 }}>
        <FormControl fullWidth>
          <InputLabel id="user-select-label">Usuario</InputLabel>
          <Select
            labelId="user-select-label"
            value={selectedUserId}
            label="Usuario"
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            {users.map((u) => (
              <MenuItem key={u.userId} value={u.userId}>{u.email}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth>
          <InputLabel id="role-assign-label">Rol</InputLabel>
          <Select
            labelId="role-assign-label"
            value={selectedRole}
            label="Rol"
            onChange={(e) => setSelectedRole(e.target.value as UserRole)}
          >
            <MenuItem value="Administrator">Administrador</MenuItem>
            <MenuItem value="Operator">Operador</MenuItem>
          </Select>
        </FormControl>

        <Typography variant="subtitle2" sx={{ mt: 1 }}>Permisos</Typography>
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {allPermissions.map((perm) => (
            <Chip
              key={perm}
              label={perm}
              onClick={() => handleTogglePermission(perm)}
              color={selectedPermissions.includes(perm) ? 'primary' : 'default'}
              variant={selectedPermissions.includes(perm) ? 'filled' : 'outlined'}
              size="small"
            />
          ))}
        </Paper>

        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!selectedUserId || saving}
          sx={{ alignSelf: 'flex-start' }}
        >
          {saving ? <CircularProgress size={20} /> : 'Asignar Rol'}
        </Button>
      </Box>
    </Box>
  );
}


/* ------------------------------------------------------------------ */
/*  Tab 3: Configuración del Sistema                                   */
/* ------------------------------------------------------------------ */
interface SystemConfig {
  toleranceThreshold: number;
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  autoProcessing: boolean;
}

function SystemConfigTab() {
  const [config, setConfig] = useState<SystemConfig>({
    toleranceThreshold: 0.01,
    notificationsEnabled: true,
    emailNotifications: true,
    autoProcessing: true,
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // Placeholder: en producción se guardaría en backend
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Configuración del Sistema</Typography>

      {saved && <Alert severity="success" sx={{ mb: 2 }}>Configuración guardada correctamente.</Alert>}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>Umbrales de Tolerancia</Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Porcentaje de diferencia permitido antes de marcar como discrepancia.
              </Typography>
              <Box sx={{ px: 2, mt: 2 }}>
                <Typography gutterBottom>
                  Tolerancia: {(config.toleranceThreshold * 100).toFixed(1)}%
                </Typography>
                <Slider
                  value={config.toleranceThreshold}
                  onChange={(_, v) => setConfig((c) => ({ ...c, toleranceThreshold: v as number }))}
                  min={0}
                  max={0.1}
                  step={0.001}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => `${(v * 100).toFixed(1)}%`}
                  aria-label="Umbral de tolerancia"
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>Notificaciones</Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.notificationsEnabled}
                    onChange={(e) => setConfig((c) => ({ ...c, notificationsEnabled: e.target.checked }))}
                  />
                }
                label="Notificaciones habilitadas"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.emailNotifications}
                    onChange={(e) => setConfig((c) => ({ ...c, emailNotifications: e.target.checked }))}
                  />
                }
                label="Notificaciones por correo"
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>Procesamiento</Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.autoProcessing}
                    onChange={(e) => setConfig((c) => ({ ...c, autoProcessing: e.target.checked }))}
                  />
                }
                label="Procesamiento automático tras carga"
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Button variant="contained" onClick={handleSave} sx={{ mt: 3 }}>
        Guardar Configuración
      </Button>
    </Box>
  );
}


/* ------------------------------------------------------------------ */
/*  Tab 4: Supervisión                                                 */
/* ------------------------------------------------------------------ */
interface SupervisionTabProps {
  dashboardData: DashboardData | null;
  loading: boolean;
  error: string | null;
}

function SupervisionTab({ dashboardData, loading, error }: SupervisionTabProps) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress aria-label="Cargando supervisión" />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!dashboardData) {
    return <Typography color="text.secondary">No hay datos disponibles.</Typography>;
  }

  const { reconciliation, quality, remediation } = dashboardData;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Supervisión del Sistema</Typography>

      <Grid container spacing={3}>
        {/* Cargas */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Total Facturas</Typography>
              <Typography variant="h4">{reconciliation.totalInvoices}</Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Validaciones */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Reglas de Calidad</Typography>
              <Typography variant="h4">{quality.totalRules}</Typography>
              <Typography variant="body2" color="text.secondary">
                {quality.passed} pasaron / {quality.failed} fallaron
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Discrepancias */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Discrepancias</Typography>
              <Typography variant="h4">{reconciliation.invoicesWithDiscrepancies}</Typography>
              <Typography variant="body2" color="text.secondary">
                Tasa: {(reconciliation.discrepancyRate * 100).toFixed(1)}%
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Remediaciones */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Remediaciones</Typography>
              <Typography variant="h4">{remediation.proposed}</Typography>
              <Typography variant="body2" color="text.secondary">
                {remediation.approved} aprobadas / {remediation.pendingApproval} pendientes
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Detalle de discrepancias por tipo */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>Discrepancias por Tipo</Typography>
          <TableContainer>
            <Table size="small" aria-label="Discrepancias por tipo">
              <TableHead>
                <TableRow>
                  <TableCell>Tipo</TableCell>
                  <TableCell align="right">Cantidad</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(reconciliation.countByType).map(([type, count]) => (
                  <TableRow key={type}>
                    <TableCell>{formatDiscrepancyType(type)}</TableCell>
                    <TableCell align="right">{count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Estado de remediación detallado */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>Estado de Remediación</Typography>
          <TableContainer>
            <Table size="small" aria-label="Estado de remediación">
              <TableHead>
                <TableRow>
                  <TableCell>Estado</TableCell>
                  <TableCell align="right">Cantidad</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow><TableCell>Pendientes de aprobación</TableCell><TableCell align="right">{remediation.pendingApproval}</TableCell></TableRow>
                <TableRow><TableCell>Aprobadas</TableCell><TableCell align="right">{remediation.approved}</TableCell></TableRow>
                <TableRow><TableCell>Rechazadas</TableCell><TableCell align="right">{remediation.rejected}</TableCell></TableRow>
                <TableRow><TableCell>XML Generados</TableCell><TableCell align="right">{remediation.xmlGenerated}</TableCell></TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}

function formatDiscrepancyType(type: string): string {
  const map: Record<string, string> = {
    missing_invoice: 'Factura perdida',
    total_difference: 'Diferencia de total',
    item_count_difference: 'Diferencia de ítems',
    missing_item: 'Ítem perdido',
  };
  return map[type] ?? type;
}


/* ------------------------------------------------------------------ */
/*  Main AdminPage component                                           */
/* ------------------------------------------------------------------ */
export default function AdminPage() {
  const [tabIndex, setTabIndex] = useState(0);

  // User management state
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Supervision state
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [supervisionLoading, setSupervisionLoading] = useState(true);
  const [supervisionError, setSupervisionError] = useState<string | null>(null);

  const userService = UserManagementService.getInstance();
  const dashboardServiceInstance = DashboardService.getInstance();

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const result = await userService.listUsers();
      setUsers(result.items);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Error al cargar usuarios.');
    } finally {
      setUsersLoading(false);
    }
  }, [userService]);

  const loadDashboard = useCallback(async () => {
    setSupervisionLoading(true);
    setSupervisionError(null);
    try {
      const data = await dashboardServiceInstance.getDashboardData(0);
      setDashboardData(data);
    } catch (err) {
      setSupervisionError(err instanceof Error ? err.message : 'Error al cargar datos de supervisión.');
    } finally {
      setSupervisionLoading(false);
    }
  }, [dashboardServiceInstance]);

  useEffect(() => {
    loadUsers();
    loadDashboard();
  }, [loadUsers, loadDashboard]);

  const handleCreateUser = async (data: CreateUserInput) => {
    await userService.createUser(data);
  };

  const handleUpdateUser = async (userId: string, data: UpdateUserInput) => {
    await userService.updateUser(userId, data);
  };

  const handleDeactivateUser = async (userId: string) => {
    await userService.deactivateUser(userId);
  };

  const handleDeleteUser = async (userId: string) => {
    await userService.deleteUser(userId);
  };

  const handleAssignRole = async (userId: string, role: UserRole, permissions: string[]) => {
    await userService.assignRole(userId, role, permissions);
    await loadUsers();
  };

  return (
    <Box role="region" aria-label="Panel de administración">
      <Typography variant="h4" component="h1" gutterBottom>
        Panel de Administración
      </Typography>

      <Tabs
        value={tabIndex}
        onChange={(_, v) => setTabIndex(v)}
        aria-label="Pestañas de administración"
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Gestión de Usuarios" id="admin-tab-0" aria-controls="admin-tabpanel-0" />
        <Tab label="Asignación de Roles" id="admin-tab-1" aria-controls="admin-tabpanel-1" />
        <Tab label="Configuración" id="admin-tab-2" aria-controls="admin-tabpanel-2" />
        <Tab label="Supervisión" id="admin-tab-3" aria-controls="admin-tabpanel-3" />
      </Tabs>

      <TabPanel value={tabIndex} index={0}>
        <UserManagementTab
          users={users}
          loading={usersLoading}
          error={usersError}
          onRefresh={loadUsers}
          onCreateUser={handleCreateUser}
          onUpdateUser={handleUpdateUser}
          onDeactivateUser={handleDeactivateUser}
          onDeleteUser={handleDeleteUser}
        />
      </TabPanel>

      <TabPanel value={tabIndex} index={1}>
        <RoleAssignmentTab users={users} onAssignRole={handleAssignRole} />
      </TabPanel>

      <TabPanel value={tabIndex} index={2}>
        <SystemConfigTab />
      </TabPanel>

      <TabPanel value={tabIndex} index={3}>
        <SupervisionTab
          dashboardData={dashboardData}
          loading={supervisionLoading}
          error={supervisionError}
        />
      </TabPanel>
    </Box>
  );
}
