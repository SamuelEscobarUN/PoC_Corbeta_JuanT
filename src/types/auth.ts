/**
 * Authentication and authorization type definitions.
 *
 * Defines the core interfaces for user profiles, auth sessions,
 * permission constants, and role-based permission mapping used
 * throughout the platform.
 *
 * ## Cómo agregar un nuevo rol
 *
 * Para agregar un nuevo rol (por ejemplo, 'Auditor' o 'Viewer'):
 *
 * 1. Agregar el rol al tipo unión `UserRole`:
 *    ```ts
 *    export type UserRole = 'Administrator' | 'Operator' | 'Auditor';
 *    ```
 *
 * 2. Agregar los permisos del nuevo rol en `RolePermissions`:
 *    ```ts
 *    Auditor: [
 *      Permissions.DASHBOARD_VIEW,
 *      Permissions.DISCREPANCY_VIEW,
 *      Permissions.FINDING_VIEW,
 *      Permissions.QUALITY_VIEW,
 *    ],
 *    ```
 *
 * 3. (Opcional) Agregar elementos de navegación en `MainLayout.tsx`
 *    restringidos al nuevo rol usando la propiedad `roles` de `NavItem`.
 *
 * 4. Crear el grupo correspondiente en Amazon Cognito.
 *
 * No se requieren cambios estructurales en `ProtectedRoute`, `useAuth`,
 * ni en otros componentes — el sistema de control de acceso se basa
 * en el mapa `RolePermissions` y funciona automáticamente con cualquier
 * rol definido aquí.
 */

/** Grupos de usuario de Cognito que mapean a roles de la aplicación. */
export type UserRole = 'Administrator' | 'Operator';

/** Represents an authenticated user's profile. */
export interface UserProfile {
  userId: string;
  email: string;
  role: UserRole;
  permissions: string[];
  isActive: boolean;
}

/** Session data returned after successful authentication. */
export interface AuthSession {
  user: UserProfile;
  accessToken: string;
  idToken: string;
}

/**
 * All permission constants used across the platform.
 * Grouped by functional module for clarity.
 */
export const Permissions = {
  // Upload module
  UPLOAD_CSV: 'upload:csv',
  UPLOAD_VIEW: 'upload:view',

  // Discrepancy module
  DISCREPANCY_VIEW: 'discrepancy:view',

  // Finding module
  FINDING_VIEW: 'finding:view',

  // Correction / remediation module
  CORRECTION_PROPOSE: 'correction:propose',
  CORRECTION_APPROVE: 'correction:approve',
  CORRECTION_REJECT: 'correction:reject',

  // Quality module
  QUALITY_VIEW: 'quality:view',
  QUALITY_MANAGE: 'quality:manage',

  // Dashboard
  DASHBOARD_VIEW: 'dashboard:view',

  // Conversational agent
  AGENT_QUERY: 'agent:query',

  // User management (admin only)
  USERS_MANAGE: 'users:manage',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

/**
 * Maps each role to its granted permissions.
 *
 * - Administrator: ALL permissions.
 * - Operator: a curated subset for day-to-day operations.
 */
export const RolePermissions: Record<UserRole, Permission[]> = {
  Administrator: Object.values(Permissions),
  Operator: [
    Permissions.UPLOAD_CSV,
    Permissions.UPLOAD_VIEW,
    Permissions.DISCREPANCY_VIEW,
    Permissions.FINDING_VIEW,
    Permissions.CORRECTION_PROPOSE,
    Permissions.QUALITY_VIEW,
    Permissions.DASHBOARD_VIEW,
    Permissions.AGENT_QUERY,
  ],
};
