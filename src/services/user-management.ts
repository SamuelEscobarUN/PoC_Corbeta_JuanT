/**
 * UserManagementService — admin-only service for managing platform users.
 *
 * Calls REST API endpoints that proxy to Lambda handlers performing
 * Cognito Admin API operations. The Lambda backend will be implemented
 * in a later task; this service defines the client-side contract.
 *
 * Endpoints:
 *   POST   /api/users          → createUser
 *   PUT    /api/users/:id      → updateUser
 *   POST   /api/users/:id/deactivate → deactivateUser
 *   DELETE /api/users/:id      → deleteUser
 *   POST   /api/users/:id/role → assignRole
 *   GET    /api/users          → listUsers
 */
import type { UserProfile } from '../types/auth';
import type {
  CreateUserInput,
  UpdateUserInput,
  UserFilters,
  PaginatedResult,
} from '../types/user-management';

const API_BASE = '/api/users';

/** Standard shape returned by the API on errors. */
interface ApiErrorBody {
  message?: string;
}

/**
 * Parse an API error response into a descriptive Error.
 */
async function handleErrorResponse(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body: ApiErrorBody = await res.json();
    if (body.message) {
      message = body.message;
    }
  } catch {
    // response body wasn't JSON — use fallback
  }
  throw new Error(message);
}

export class UserManagementService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: UserManagementService;
  private readonly baseUrl: string;

  private constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  static getInstance(): UserManagementService {
    if (!UserManagementService.instance) {
      UserManagementService.instance = new UserManagementService();
    }
    return UserManagementService.instance;
  }

  /** Create an instance with a custom base URL (useful for testing). */
  static create(baseUrl: string): UserManagementService {
    return new UserManagementService(baseUrl);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  /** Create a new user in Cognito and return the created profile. */
  async createUser(data: CreateUserInput): Promise<UserProfile> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await handleErrorResponse(res, `Failed to create user: ${res.status}`);
    }

    return res.json() as Promise<UserProfile>;
  }

  /** Update an existing user's attributes. */
  async updateUser(userId: string, data: UpdateUserInput): Promise<UserProfile> {
    const res = await fetch(`${this.baseUrl}/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await handleErrorResponse(res, `Failed to update user ${userId}: ${res.status}`);
    }

    return res.json() as Promise<UserProfile>;
  }

  /** Deactivate a user (soft-delete — keeps the account but disables access). */
  async deactivateUser(userId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/${encodeURIComponent(userId)}/deactivate`,
      { method: 'POST' },
    );

    if (!res.ok) {
      await handleErrorResponse(res, `Failed to deactivate user ${userId}: ${res.status}`);
    }
  }

  /** Permanently delete a user from Cognito. */
  async deleteUser(userId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      await handleErrorResponse(res, `Failed to delete user ${userId}: ${res.status}`);
    }
  }

  /** Assign a role and permissions to a user (updates Cognito group membership). */
  async assignRole(userId: string, role: string, permissions: string[]): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/${encodeURIComponent(userId)}/role`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, permissions }),
      },
    );

    if (!res.ok) {
      await handleErrorResponse(res, `Failed to assign role to user ${userId}: ${res.status}`);
    }
  }

  /** List users with optional filters and pagination. */
  async listUsers(filters?: UserFilters): Promise<PaginatedResult<UserProfile>> {
    const params = new URLSearchParams();

    if (filters?.role) params.set('role', filters.role);
    if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive));
    if (filters?.search) params.set('search', filters.search);
    if (filters?.page !== undefined) params.set('page', String(filters.page));
    if (filters?.pageSize !== undefined) params.set('pageSize', String(filters.pageSize));

    const query = params.toString();
    const url = query ? `${this.baseUrl}?${query}` : this.baseUrl;

    const res = await fetch(url);

    if (!res.ok) {
      await handleErrorResponse(res, `Failed to list users: ${res.status}`);
    }

    return res.json() as Promise<PaginatedResult<UserProfile>>;
  }
}

/** Default singleton instance for convenience imports. */
export const userManagementService = UserManagementService.getInstance();
