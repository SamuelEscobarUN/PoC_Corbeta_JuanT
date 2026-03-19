import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AuthService before importing App
vi.mock('./services/auth', () => ({
  authService: {
    getCurrentUser: vi.fn(),
    hasPermission: vi.fn(() => false),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  },
  AuthService: { getInstance: vi.fn() },
}));

// Mock Amplify Authenticator
vi.mock('@aws-amplify/ui-react', () => ({
  Authenticator: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="authenticator">{children}</div>
  ),
}));

import App from './App';
import { authService } from './services/auth';

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows login page with Amplify Authenticator for unauthenticated users', async () => {
    vi.mocked(authService.getCurrentUser).mockRejectedValue(
      new Error('Not authenticated'),
    );

    render(<App />);

    // After auth check fails, should redirect to login and show Authenticator
    expect(
      await screen.findByTestId('authenticator'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Plataforma de Reconciliación de Datos'),
    ).toBeInTheDocument();
  });

  it('renders the app with routing configured', () => {
    // Just verify the app renders without crashing
    vi.mocked(authService.getCurrentUser).mockRejectedValue(
      new Error('Not authenticated'),
    );

    const { container } = render(<App />);
    expect(container).toBeTruthy();
  });
});
