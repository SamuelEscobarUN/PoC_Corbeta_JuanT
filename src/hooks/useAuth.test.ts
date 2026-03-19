import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/auth', () => ({
  authService: {
    getCurrentUser: vi.fn(),
    hasPermission: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  },
}));

import { useAuth } from './useAuth';
import { authService } from '../services/auth';
import type { UserProfile } from '../types/auth';

const mockAdmin: UserProfile = {
  userId: 'u-1',
  email: 'admin@test.com',
  role: 'Administrator',
  permissions: ['dashboard:view', 'users:manage'],
  isActive: true,
};

const mockOperator: UserProfile = {
  userId: 'u-2',
  email: 'op@test.com',
  role: 'Operator',
  permissions: ['dashboard:view'],
  isActive: true,
};

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in loading state', () => {
    vi.mocked(authService.getCurrentUser).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuth());

    expect(result.current.loading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('loads authenticated user profile', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(mockAdmin);
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(mockAdmin);
    expect(result.current.role).toBe('Administrator');
  });

  it('sets user to null when not authenticated', async () => {
    vi.mocked(authService.getCurrentUser).mockRejectedValue(new Error('No user'));
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.role).toBeNull();
  });

  it('hasRole returns true for matching role', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(mockOperator);
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasRole('Operator')).toBe(true);
    expect(result.current.hasRole('Administrator')).toBe(false);
  });

  it('hasPermission delegates to authService', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(mockAdmin);
    vi.mocked(authService.hasPermission).mockReturnValue(true);
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasPermission('users:manage')).toBe(true);
    expect(authService.hasPermission).toHaveBeenCalledWith('users:manage');
  });

  it('signOut clears user state', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(mockAdmin);
    vi.mocked(authService.signOut).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});
