import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme';
import LoginPage from './components/organisms/LoginPage';
import ProtectedRoute from './components/atoms/ProtectedRoute';
import MainLayout from './components/templates/MainLayout';
import UploadPage from './components/pages/UploadPage';
import QualityRulesPage from './components/pages/QualityRulesPage';
import DashboardPage from './components/pages/DashboardPage';
import RemediationPage from './components/pages/RemediationPage';
import AdminPage from './components/pages/AdminPage';
import DiscrepanciesPage from './components/pages/DiscrepanciesPage';
import SessionsPage from './components/pages/SessionsPage';
import SessionDetailPage from './components/pages/SessionDetailPage';


function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          {/* Public route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected routes — require authentication */}
          <Route element={<ProtectedRoute />}>
            <Route element={<MainLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/uploads" element={<UploadPage />} />
              <Route path="/discrepancies" element={<DiscrepanciesPage />} />
              <Route path="/findings" element={<Navigate to="/discrepancies" replace />} />
              <Route path="/sessions" element={<SessionsPage />} />
              <Route path="/sessions/:id" element={<SessionDetailPage />} />
              <Route path="/remediation" element={<RemediationPage />} />

              {/* Admin-only routes */}
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute requiredRole="Administrator">
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/quality-rules"
                element={
                  <ProtectedRoute requiredRole="Administrator">
                    <QualityRulesPage />
                  </ProtectedRoute>
                }
              />

              {/* Default redirect */}
              <Route index element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
