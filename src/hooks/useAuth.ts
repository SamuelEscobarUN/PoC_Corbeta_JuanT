/**
 * useAuth — React hook that wraps AuthService for component use.
 *
 * Provides the current user profile, role, loading state, and
 * convenience methods for authentication operations.
 */
import { useState, useEffect, useCallback } from 'react';
import type { UserProfile, UserRole, Permission } from '../types/auth';
import { authService } from '../services/auth';

export interface UseAuthReturn {
  /** Current user profile, null if not authenticated. */
  user: UserProfile | null;
  /** Current user role, null if not authenticated. */
  role: UserRole | null;
  /** True while the initial auth check is in progress. */
  loading: boolean;
  /** True if the user is authenticated. */
  isAuthenticated: boolean;
  /** Check if the current user has a specific permission. */
  hasPermission: (permission: Permission | string) => boolean;
  /** Check if the current user has a specific role. */
  hasRole: (role: UserRole) => boolean;
  /** Sign out the current user. */
  signOut: () => Promise<void>;
  /** Force-refresh the user profile from Cognito. */
  refreshProfile: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const profile = await authService.getCurrentUser();
        if (!cancelled) {
          setUser(profile);
        }
      } catch {
        // Not authenticated — leave user as null
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasPermission = useCallback(
    (permission: Permission | string): boolean => {
      return authService.hasPermission(permission);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user],
  );

  const hasRole = useCallback(
    (role: UserRole): boolean => {
      return user?.role === role;
    },
    [user],
  );

  const signOut = useCallback(async () => {
    await authService.signOut();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await authService.refreshProfile();
      setUser(profile);
    } catch {
      setUser(null);
    }
  }, []);

  return {
    user,
    role: user?.role ?? null,
    loading,
    isAuthenticated: user !== null,
    hasPermission,
    hasRole,
    signOut,
    refreshProfile,
  };
}
