/**
 * AuthService — singleton service for authentication and authorization.
 *
 * Integrates with Amazon Cognito via Amplify Auth to handle sign-in,
 * sign-out, session management, and role-based permission checks.
 *
 * User roles are derived from Cognito user-group claims embedded in
 * the JWT access token (`cognito:groups`).
 */
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  getCurrentUser as amplifyGetCurrentUser,
  fetchAuthSession,
  fetchUserAttributes,
} from 'aws-amplify/auth';

import type {
  AuthSession,
  Permission,
  UserProfile,
  UserRole,
} from '../types/auth';
import { RolePermissions } from '../types/auth';

export class AuthService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: AuthService;

  /** Cached profile so we don't hit Cognito on every call. */
  private cachedProfile: UserProfile | null = null;

  private constructor() {}

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Authenticate a user with email + password via Cognito.
   * Returns an {@link AuthSession} containing the user profile and tokens.
   */
  async signIn(email: string, password: string): Promise<AuthSession> {
    await amplifySignIn({ username: email, password });

    const session = await fetchAuthSession();
    const tokens = session.tokens;

    if (!tokens?.accessToken || !tokens?.idToken) {
      throw new Error('Authentication succeeded but no tokens were returned.');
    }

    const profile = await this.buildUserProfile();
    this.cachedProfile = profile;

    return {
      user: profile,
      accessToken: tokens.accessToken.toString(),
      idToken: tokens.idToken.toString(),
    };
  }

  /** Sign the current user out and clear the cached profile. */
  async signOut(): Promise<void> {
    await amplifySignOut();
    this.cachedProfile = null;
  }

  /**
   * Return the current authenticated user's profile.
   * Uses a cached value when available; call {@link refreshProfile} to force
   * a fresh fetch.
   */
  async getCurrentUser(): Promise<UserProfile> {
    if (this.cachedProfile) {
      return this.cachedProfile;
    }
    const profile = await this.buildUserProfile();
    this.cachedProfile = profile;
    return profile;
  }

  /** Convenience shortcut that returns the current user's role. */
  async getUserRole(): Promise<UserRole> {
    const profile = await this.getCurrentUser();
    return profile.role;
  }

  /**
   * Synchronous permission check against the cached profile.
   *
   * Returns `false` when no profile has been loaded yet (i.e. the user
   * hasn't signed in or {@link getCurrentUser} hasn't been called).
   */
  hasPermission(permission: Permission | string): boolean {
    if (!this.cachedProfile) {
      return false;
    }
    return this.cachedProfile.permissions.includes(permission);
  }

  /** Force-refresh the cached profile from Cognito. */
  async refreshProfile(): Promise<UserProfile> {
    const profile = await this.buildUserProfile();
    this.cachedProfile = profile;
    return profile;
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Build a {@link UserProfile} by combining data from the Cognito
   * current-user call, user attributes, and the JWT access token claims.
   */
  private async buildUserProfile(): Promise<UserProfile> {
    const [cognitoUser, attributes, session] = await Promise.all([
      amplifyGetCurrentUser(),
      fetchUserAttributes(),
      fetchAuthSession(),
    ]);

    const role = this.extractRole(session);
    const permissions = RolePermissions[role];

    return {
      userId: cognitoUser.userId,
      email: attributes.email ?? '',
      role,
      permissions: [...permissions],
      isActive: true,
    };
  }

  /**
   * Extract the user's role from the `cognito:groups` claim in the
   * access token payload.
   *
   * If the user belongs to multiple groups, `Administrator` takes
   * precedence. Falls back to `Operator` when no recognised group
   * is found.
   */
  private extractRole(
    session: Awaited<ReturnType<typeof fetchAuthSession>>,
  ): UserRole {
    const payload = session.tokens?.accessToken?.payload;
    const groups = (payload?.['cognito:groups'] as string[] | undefined) ?? [];

    if (groups.includes('Administrator')) {
      return 'Administrator';
    }
    if (groups.includes('Operator')) {
      return 'Operator';
    }

    // Default to Operator for authenticated users without an explicit group.
    return 'Operator';
  }
}

/** Default singleton instance for convenience imports. */
export const authService = AuthService.getInstance();
