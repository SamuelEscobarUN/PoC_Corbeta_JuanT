/**
 * Unit tests for AuthService.
 *
 * All Amplify Auth calls are mocked so the tests run without a real
 * Cognito backend. We verify:
 *  - signIn builds a correct AuthSession
 *  - signOut clears the cached profile
 *  - getCurrentUser / getUserRole return expected values
 *  - hasPermission respects the role-based permission map
 *  - Administrator gets all permissions, Operator gets a subset
 *  - extractRole gives Administrator precedence over Operator
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mock aws-amplify/auth before importing AuthService                */
/* ------------------------------------------------------------------ */
const {
  mockSignIn,
  mockSignOut,
  mockGetCurrentUser,
  mockFetchAuthSession,
  mockFetchUserAttributes,
} = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockSignOut: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockFetchAuthSession: vi.fn(),
  mockFetchUserAttributes: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({
  signIn: mockSignIn,
  signOut: mockSignOut,
  getCurrentUser: mockGetCurrentUser,
  fetchAuthSession: mockFetchAuthSession,
  fetchUserAttributes: mockFetchUserAttributes,
}));

import { AuthService } from './auth';
import { Permissions, RolePermissions } from '../types/auth';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a fake Amplify session with the given Cognito groups. */
function fakeSession(groups: string[]) {
  return {
    tokens: {
      accessToken: {
        payload: { 'cognito:groups': groups },
        toString: () => 'fake-access-token',
      },
      idToken: { toString: () => 'fake-id-token' },
    },
  };
}

function setupCognitoMocks(
  groups: string[],
  email = 'user@example.com',
  userId = 'user-123',
) {
  mockSignIn.mockResolvedValue({});
  mockSignOut.mockResolvedValue(undefined);
  mockGetCurrentUser.mockResolvedValue({ userId, username: email });
  mockFetchAuthSession.mockResolvedValue(fakeSession(groups));
  mockFetchUserAttributes.mockResolvedValue({ email });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh instance for each test to avoid cached state.
    // We access the constructor via a cast because it's private.
    service = (AuthService as unknown as { new (): AuthService })
      ? Object.create(AuthService.prototype)
      : AuthService.getInstance();
    // Reset internal cache
    (service as unknown as Record<string, unknown>)['cachedProfile'] = null;
  });

  /* ---- signIn ---------------------------------------------------- */

  it('signIn returns an AuthSession with Administrator role', async () => {
    setupCognitoMocks(['Administrator']);

    const session = await service.signIn('admin@example.com', 'password');

    expect(mockSignIn).toHaveBeenCalledWith({
      username: 'admin@example.com',
      password: 'password',
    });
    expect(session.user.role).toBe('Administrator');
    expect(session.user.email).toBe('user@example.com');
    expect(session.accessToken).toBe('fake-access-token');
    expect(session.idToken).toBe('fake-id-token');
  });

  it('signIn returns an AuthSession with Operator role', async () => {
    setupCognitoMocks(['Operator']);

    const session = await service.signIn('op@example.com', 'password');

    expect(session.user.role).toBe('Operator');
  });

  it('signIn throws when tokens are missing', async () => {
    mockSignIn.mockResolvedValue({});
    mockFetchAuthSession.mockResolvedValue({ tokens: undefined });

    await expect(
      service.signIn('user@example.com', 'pass'),
    ).rejects.toThrow('no tokens');
  });

  /* ---- signOut --------------------------------------------------- */

  it('signOut clears the cached profile', async () => {
    setupCognitoMocks(['Administrator']);
    await service.signIn('admin@example.com', 'password');

    await service.signOut();

    expect(mockSignOut).toHaveBeenCalled();
    // After sign-out, hasPermission should return false (no cache).
    expect(service.hasPermission(Permissions.USERS_MANAGE)).toBe(false);
  });

  /* ---- getCurrentUser -------------------------------------------- */

  it('getCurrentUser returns the profile and caches it', async () => {
    setupCognitoMocks(['Operator'], 'op@example.com', 'op-456');

    const profile = await service.getCurrentUser();

    expect(profile.userId).toBe('op-456');
    expect(profile.email).toBe('op@example.com');
    expect(profile.role).toBe('Operator');
    expect(profile.isActive).toBe(true);

    // Second call should use cache (no extra Cognito calls).
    await service.getCurrentUser();
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
  });

  /* ---- getUserRole ----------------------------------------------- */

  it('getUserRole returns the role string', async () => {
    setupCognitoMocks(['Administrator']);

    const role = await service.getUserRole();

    expect(role).toBe('Administrator');
  });

  /* ---- hasPermission --------------------------------------------- */

  it('hasPermission returns false when no profile is cached', () => {
    expect(service.hasPermission(Permissions.UPLOAD_CSV)).toBe(false);
  });

  it('Administrator has all permissions', async () => {
    setupCognitoMocks(['Administrator']);
    await service.getCurrentUser();

    for (const perm of Object.values(Permissions)) {
      expect(service.hasPermission(perm)).toBe(true);
    }
  });

  it('Operator has the expected subset of permissions', async () => {
    setupCognitoMocks(['Operator']);
    await service.getCurrentUser();

    // Operator SHOULD have these
    for (const perm of RolePermissions.Operator) {
      expect(service.hasPermission(perm)).toBe(true);
    }

    // Operator should NOT have admin-only permissions
    expect(service.hasPermission(Permissions.CORRECTION_APPROVE)).toBe(false);
    expect(service.hasPermission(Permissions.CORRECTION_REJECT)).toBe(false);
    expect(service.hasPermission(Permissions.QUALITY_MANAGE)).toBe(false);
    expect(service.hasPermission(Permissions.USERS_MANAGE)).toBe(false);
  });

  /* ---- Role extraction precedence -------------------------------- */

  it('Administrator takes precedence when user is in both groups', async () => {
    setupCognitoMocks(['Operator', 'Administrator']);

    const profile = await service.getCurrentUser();

    expect(profile.role).toBe('Administrator');
  });

  it('defaults to Operator when no recognised group is present', async () => {
    setupCognitoMocks([]);

    const profile = await service.getCurrentUser();

    expect(profile.role).toBe('Operator');
  });

  /* ---- refreshProfile -------------------------------------------- */

  it('refreshProfile fetches fresh data from Cognito', async () => {
    setupCognitoMocks(['Operator'], 'op@example.com', 'op-1');
    await service.getCurrentUser();

    // Change mock to return Administrator
    setupCognitoMocks(['Administrator'], 'admin@example.com', 'admin-1');
    const refreshed = await service.refreshProfile();

    expect(refreshed.role).toBe('Administrator');
    expect(refreshed.email).toBe('admin@example.com');
  });
});
