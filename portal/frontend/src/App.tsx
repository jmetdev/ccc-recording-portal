import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { RequireAuth, RequirePermission } from './auth/RouteGuards';
import { LoginPage } from './pages/LoginPage';
import { SsoCallbackPage } from './pages/SsoCallbackPage';
import { OverviewPage } from './pages/OverviewPage';
import { RecordingsPage } from './pages/RecordingsPage';
import { SearchPage } from './pages/SearchPage';
import { RetentionPage } from './pages/RetentionPage';
import { StoragePage } from './pages/StoragePage';
import { SettingsPage } from './pages/SettingsPage';

/** Preserve old /calls/:id deep links. */
function CallRedirect() {
  const { id } = useParams();
  return <Navigate to={`/recordings/${id}`} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<SsoCallbackPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="recordings" element={<RecordingsPage />} />
            <Route path="recordings/:id" element={<RecordingsPage />} />
            <Route path="calls" element={<Navigate to="/recordings" replace />} />
            <Route path="calls/:id" element={<CallRedirect />} />
            <Route element={<RequirePermission permission="view_transcripts" />}>
              <Route path="search" element={<SearchPage />} />
            </Route>
            <Route element={<RequirePermission permission="manage_retention" />}>
              <Route path="retention" element={<RetentionPage />} />
            </Route>
            <Route path="storage" element={<StoragePage />} />
            <Route element={<RequirePermission permission="manage_users" />}>
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
