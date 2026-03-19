/**
 * MainLayout — application shell with collapsible sidebar, AppBar,
 * and responsive content area.
 */
import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
  Button,
  Chip,
  Tooltip,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import DashboardIcon from '@mui/icons-material/Dashboard';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import ChatIcon from '@mui/icons-material/Chat';
import PeopleIcon from '@mui/icons-material/People';
import RuleIcon from '@mui/icons-material/Rule';
import BuildIcon from '@mui/icons-material/Build';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../../hooks/useAuth';
import CorbetaLogo from '../atoms/CorbetaLogo';
import type { UserRole } from '../../types/auth';

const DRAWER_OPEN_WIDTH = 240;
const DRAWER_CLOSED_WIDTH = 64;

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Carga de Archivos', path: '/uploads', icon: <UploadFileIcon /> },
  { label: 'Discrepancias', path: '/discrepancies', icon: <CompareArrowsIcon /> },
  { label: 'Hallazgos', path: '/findings', icon: <FindInPageIcon /> },
  { label: 'Agente Conversacional', path: '/agent', icon: <ChatIcon /> },
  { label: 'Gestión de Usuarios', path: '/admin/users', icon: <PeopleIcon />, roles: ['Administrator'] },
  { label: 'Reglas de Calidad', path: '/admin/quality-rules', icon: <RuleIcon />, roles: ['Administrator'] },
  { label: 'Remediación', path: '/remediation', icon: <BuildIcon /> },
];

function getVisibleItems(role: UserRole | null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

export default function MainLayout() {
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const visibleItems = getVisibleItems(role);
  const currentWidth = open ? DRAWER_OPEN_WIDTH : DRAWER_CLOSED_WIDTH;

  const handleNavigate = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const drawerContent = (expanded: boolean) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Toolbar sx={{ justifyContent: expanded ? 'space-between' : 'center', px: expanded ? 2 : 0 }}>
        {expanded ? <CorbetaLogo width={140} height={40} /> : null}
        <IconButton onClick={() => { setOpen(!open); setMobileOpen(false); }} aria-label={expanded ? 'Colapsar menú' : 'Expandir menú'}>
          {expanded ? <ChevronLeftIcon /> : <MenuIcon />}
        </IconButton>
      </Toolbar>
      <Divider />
      <nav aria-label="Navegación principal">
        <List>
          {visibleItems.map((item) => (
            <ListItem key={item.path} disablePadding sx={{ display: 'block' }}>
              <Tooltip title={expanded ? '' : item.label} placement="right" arrow>
                <ListItemButton
                  selected={location.pathname === item.path}
                  onClick={() => handleNavigate(item.path)}
                  aria-current={location.pathname === item.path ? 'page' : undefined}
                  sx={{ minHeight: 48, justifyContent: expanded ? 'initial' : 'center', px: 2.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 0, mr: expanded ? 2 : 'auto', justifyContent: 'center' }}>
                    {item.icon}
                  </ListItemIcon>
                  {expanded && <ListItemText primary={item.label} />}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          ))}
        </List>
      </nav>
      <Box sx={{ flexGrow: 1 }} />
      <Divider />
      <Box sx={{ p: expanded ? 2 : 1, display: 'flex', justifyContent: 'center' }}>
        {expanded ? (
          <Button fullWidth variant="outlined" color="error" startIcon={<LogoutIcon />} onClick={handleSignOut} aria-label="Cerrar sesión">
            Cerrar Sesión
          </Button>
        ) : (
          <Tooltip title="Cerrar Sesión" placement="right" arrow>
            <IconButton color="error" onClick={handleSignOut} aria-label="Cerrar sesión">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* AppBar */}
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(!mobileOpen)} sx={{ mr: 2, display: { md: 'none' } }} aria-label="Abrir menú">
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            Plataforma de Reconciliación de Datos
          </Typography>
          {user && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
                {user.email}
              </Typography>
              <Chip label={role} size="small" color={role === 'Administrator' ? 'secondary' : 'default'} sx={{ color: 'white' }} />
            </Box>
          )}
        </Toolbar>
      </AppBar>

      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: DRAWER_OPEN_WIDTH } }}
        ModalProps={{ keepMounted: true }}
      >
        {drawerContent(true)}
      </Drawer>

      {/* Desktop drawer — collapsible */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': {
            width: currentWidth,
            transition: 'width 0.2s ease',
            overflowX: 'hidden',
            boxSizing: 'border-box',
          },
        }}
        open
      >
        {drawerContent(open)}
      </Drawer>

      {/* Main content */}
      <Box
        component="main"
        aria-label="Contenido principal"
        sx={{
          flexGrow: 1,
          p: 3,
          mt: 8,
          ml: { md: `${currentWidth}px` },
          transition: 'margin-left 0.2s ease',
          bgcolor: 'background.default',
          minHeight: '100vh',
          width: { md: `calc(100% - ${currentWidth}px)` },
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
