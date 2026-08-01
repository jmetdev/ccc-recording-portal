import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthContext';
import { App } from './App';
import { createTheme } from './theme';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

const queryClient = new QueryClient();
const theme = createTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} forceColorScheme="light">
        <Notifications />
        <AuthProvider>
          <App />
        </AuthProvider>
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
