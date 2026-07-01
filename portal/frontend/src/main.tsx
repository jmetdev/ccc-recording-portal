import React from 'react';
import ReactDOM from 'react-dom/client';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthContext';
import { App } from './App';
import { ThemeSettingsProvider } from './theme/ThemeSettingsContext';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeSettingsProvider>
        <Notifications />
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeSettingsProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
