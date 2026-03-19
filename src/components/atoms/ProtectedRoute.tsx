/**
 * ProtectedRoute — guards a route by checking authentication,
 * required role, and/or required permission.
 *
 * - If the user is not authenticated → redirects to /login.
 * - If the user lacks the required role or permission → shows "Acceso denegado".
 * - Otherwise → renders the child outlet/element.
 */
import { Navigate, Outlet } from 'react-router-dom';
import { Box, Typography, Button } from '@mui/material';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole, Permission } from '../../types/auth';

export interface ProtectedRouteProps {
  /** If set, the user must have this role. */
  requiredRole?: UserRole;
  /** If set, the user must have this permission. */
  requiredPermission?: Permission | string;
  /** Optional children; falls back to <Outlet /> for nested routes. */
  children?: React.ReactNode;
}

export default function ProtectedRoute({
  requiredRole,
  requiredPermission,
  children,
}: ProtectedRouteProps) {
  const { user, loading, isAuthenticated, hasPermission, hasRole } = useAuth();

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
        role="status"
        aria-label="Verificando autenticación"
      >
        <Typography>Cargando...</Typography>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check role
  if (requiredRole && !hasRole(requiredRole)) {
    return <AccessDenied userName={user?.email} />;
  }

  // Check permission
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <AccessDenied userName={user?.email} />;
  }

  return children ? <>{children}</> : <Outlet />;
}

function AccessDenied({ userName }: { userName?: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: 2,
      }}
      role="alert"
      aria-live="assertive"
    >
      <Typography variant="h4" color="error">
        Acceso Denegado
      </Typography>
      <Typography color="text.secondary">
        {userName
          ? `El usuario ${userName} no tiene permisos para acceder a esta sección.`
          : 'No tiene permisos para acceder a esta sección.'}
      </Typography>
      <Button variant="contained" href="/">
        Volver al inicio
      </Button>
    </Box>
  );
}
