/**
 * Unit tests for UserManagementService.
 *
 * Uses a global fetch mock to simulate API responses. Each test verifies
 * the correct HTTP method, URL, headers, body, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserManagementService } from './user-management';
import type { UserProfile } from '../types/auth';
import type { PaginatedResult } from '../types/user-management';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const mockFetch = vi.fn();

function jsonResponse<T>(body: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errorResponse(status: number, message?: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(message ? { message } : {}),
  } as unknown as Response;
}

const fakeUser: UserProfile = {
  userId: 'u-1',
  email: 'alice@example.com',
  role: 'Operator',
  permissions: ['upload:csv', 'upload:view'],
  isActive: true,
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('UserManagementService', () => {
  let service: UserManagementService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    service = UserManagementService.create('/api/users');
  });

  /* ---- createUser ------------------------------------------------ */

  describe('createUser', () => {
    it('sends POST with correct body and returns the created user', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(fakeUser, 201));

      const result = await service.createUser({
        email: 'alice@example.com',
        role: 'Operator',
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@example.com', role: 'Operator' }),
      });
      expect(result).toEqual(fakeUser);
    });

    it('throws with API error message on failure', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(409, 'User already exists'),
      );

      await expect(
        service.createUser({ email: 'dup@example.com', role: 'Operator' }),
      ).rejects.toThrow('User already exists');
    });

    it('throws with fallback message when API returns no message', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500));

      await expect(
        service.createUser({ email: 'x@example.com', role: 'Operator' }),
      ).rejects.toThrow('Failed to create user: 500');
    });
  });

  /* ---- updateUser ------------------------------------------------ */

  describe('updateUser', () => {
    it('sends PUT to the correct URL with update data', async () => {
      const updated = { ...fakeUser, email: 'alice-new@example.com' };
      mockFetch.mockResolvedValueOnce(jsonResponse(updated));

      const result = await service.updateUser('u-1', {
        email: 'alice-new@example.com',
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/users/u-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice-new@example.com' }),
      });
      expect(result.email).toBe('alice-new@example.com');
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, 'User not found'));

      await expect(
        service.updateUser('missing', { name: 'X' }),
      ).rejects.toThrow('User not found');
    });
  });

  /* ---- deactivateUser -------------------------------------------- */

  describe('deactivateUser', () => {
    it('sends POST to /deactivate endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(null, 204));

      await service.deactivateUser('u-1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/users/u-1/deactivate',
        { method: 'POST' },
      );
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

      await expect(service.deactivateUser('u-1')).rejects.toThrow('Forbidden');
    });
  });

  /* ---- deleteUser ------------------------------------------------ */

  describe('deleteUser', () => {
    it('sends DELETE to the correct URL', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(null, 204));

      await service.deleteUser('u-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/users/u-1', {
        method: 'DELETE',
      });
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, 'Not found'));

      await expect(service.deleteUser('u-1')).rejects.toThrow('Not found');
    });
  });

  /* ---- assignRole ------------------------------------------------ */

  describe('assignRole', () => {
    it('sends POST with role and permissions', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(null, 200));

      await service.assignRole('u-1', 'Administrator', [
        'upload:csv',
        'users:manage',
      ]);

      expect(mockFetch).toHaveBeenCalledWith('/api/users/u-1/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'Administrator',
          permissions: ['upload:csv', 'users:manage'],
        }),
      });
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(400, 'Invalid role'));

      await expect(
        service.assignRole('u-1', 'BadRole', []),
      ).rejects.toThrow('Invalid role');
    });
  });

  /* ---- listUsers ------------------------------------------------- */

  describe('listUsers', () => {
    const paginatedResult: PaginatedResult<UserProfile> = {
      items: [fakeUser],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };

    it('sends GET without query params when no filters', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(paginatedResult));

      const result = await service.listUsers();

      expect(mockFetch).toHaveBeenCalledWith('/api/users');
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('appends query params from filters', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(paginatedResult));

      await service.listUsers({
        role: 'Operator',
        isActive: true,
        search: 'alice',
        page: 2,
        pageSize: 10,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('role=Operator');
      expect(calledUrl).toContain('isActive=true');
      expect(calledUrl).toContain('search=alice');
      expect(calledUrl).toContain('page=2');
      expect(calledUrl).toContain('pageSize=10');
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, 'Internal error'));

      await expect(service.listUsers()).rejects.toThrow('Internal error');
    });
  });

  /* ---- URL encoding ---------------------------------------------- */

  it('encodes special characters in userId', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(null, 204));

    await service.deleteUser('user/with spaces');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/users/user%2Fwith%20spaces');
  });

  /* ---- Singleton ------------------------------------------------- */

  it('getInstance returns the same instance', () => {
    const a = UserManagementService.getInstance();
    const b = UserManagementService.getInstance();
    expect(a).toBe(b);
  });
});
