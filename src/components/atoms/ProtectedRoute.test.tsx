import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/auth', () => ({
  authService: {
    getCurrentUser: vi.fn(),
    hasPermission: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  },
}));

import ProtectedRoute from './ProtectedRoute';
import { authService } from '../../services/auth';
import type { UserProfile } from '../../types/auth';

const admin: UserProfile = {
  userId: 'u-1',
  email: 'admin@test.com',
  role: 'Administrator',
  permissions: ['users:manage', 'dashboard:view'],
  isActive: true,
};

const operator: UserProfile = {
  userId: 'u-2',
  email: 'op@test.com',
  role: 'Operator',
  permissions: ['dashboard:view'],
  isActive: true,
};

function renderWithRouter(
  ui: React.ReactElement,
  { initialEntries = ['/protected'] } = {},
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/protected" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading while auth check is pending', () => {
    vi.mocked(authService.getCurrentUser).mockReturnValue(new Promise(() => {}));

    renderWithRouter(
      <ProtectedRoute>
        <div>Secret Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Cargando...')).toBeInTheDocument();
    expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', async () => {
    vi.mocked(authService.getCurrentUser).mockRejectedValue(new Error('No user'));

    renderWithRouter(
      <ProtectedRoute>
        <div>Secret Content</div>
      </ProtectedRoute>,
    );

    expect(await screen.findByText('Login Page')).toBeInTheDocument();
  });

  it('renders children when authenticated with no role requirement', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(operator);

    renderWithRouter(
      <ProtectedRoute>
        <div>Secret Content</div>
      </ProtectedRoute>,
    );

    expect(await screen.findByText('Secret Content')).toBeInTheDocument();
  });

  it('shows access denied when user lacks required role', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(operator);

    renderWithRouter(
      <ProtectedRoute requiredRole="Administrator">
        <div>Admin Only</div>
      </ProtectedRoute>,
    );

    expect(await screen.findByText('Acceso Denegado')).toBeInTheDocument();
    expect(screen.queryByText('Admin Only')).not.toBeInTheDocument();
  });

  it('renders children when user has required role', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(admin);

    renderWithRouter(
      <ProtectedRoute requiredRole="Administrator">
        <div>Admin Only</div>
      </ProtectedRoute>,
    );

    expect(await screen.findByText('Admin Only')).toBeInTheDocument();
  });

  it('shows access denied when user lacks required permission', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(operator);
    vi.mocked(authService.hasPermission).mockReturnValue(false);

    renderWithRouter(
      <ProtectedRoute requiredPermission="users:manage">
        <div>Manage Users</div>
      </ProtectedRoute>,
    );

    expect(await screen.findByText('Acceso Denegado')).toBeInTheDocument();
  });

  it('renders children when user has required permission', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(admin);
    vi.mocked(authService.hasPermission).mockReturnValue(true);

    renderWithRouter(
      <ProtectedRoute requiredPermission="users:manage">
        <div>Manage Users</div>
      </ProtectedRoute>,
    );

    expect(await screen.findByText('Manage Users')).toBeInTheDocument();
  });
});
