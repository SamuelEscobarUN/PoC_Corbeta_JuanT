/**
 * LoginPage — wraps the Amplify Authenticator component with the app's
 * Material 3 theme styling.
 *
 * After successful sign-in, redirects to /dashboard.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Box, Typography } from '@mui/material';
import CorbetaLogo from '../atoms/CorbetaLogo';

/**
 * Inner component that lives inside <Authenticator> so it can
 * access the authStatus and trigger navigation on sign-in.
 */
function AuthRedirect() {
  const navigate = useNavigate();
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);

  useEffect(() => {
    if (authStatus === 'authenticated') {
      navigate('/dashboard', { replace: true });
    }
  }, [authStatus, navigate]);

  return null;
}

export default function LoginPage() {
  return (
    <Box
      component="main"
      role="main"
      aria-label="Inicio de sesión"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ mb: 2 }}>
        <CorbetaLogo width={280} height={80} />
      </Box>

      <Typography
        variant="h4"
        component="h1"
        color="primary"
        sx={{ mb: 4, fontWeight: 600 }}
      >
        Plataforma de Reconciliación de Datos
      </Typography>

      <Authenticator
        hideSignUp
        variation="default"
        loginMechanisms={['email']}
      >
        {() => <AuthRedirect />}
      </Authenticator>
    </Box>
  );
}
