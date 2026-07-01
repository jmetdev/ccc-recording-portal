import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { RequireAuth, RequirePermission } from './auth/RouteGuards';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CallSearchPage } from './pages/CallSearchPage';
import { CallPlayerPage } from './pages/CallPlayerPage';
import { TranscriptionSearchPage } from './pages/TranscriptionSearchPage';
import { AdminPage } from './pages/AdminPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="calls" element={<CallSearchPage />} />
            <Route path="calls/:id" element={<CallPlayerPage />} />
            <Route element={<RequirePermission permission="view_transcripts" />}>
              <Route path="transcripts" element={<TranscriptionSearchPage />} />
            </Route>
            <Route element={<RequirePermission permission="manage_users" />}>
              <Route path="admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
