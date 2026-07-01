import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { MantineProvider, type MantinePrimaryShade } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { createTheme } from './index';

export const PRIMARY_COLOR_OPTIONS = ['blue', 'teal', 'violet'] as const;
export type PrimaryColorOption = (typeof PRIMARY_COLOR_OPTIONS)[number];
export type ColorSchemeOption = 'light' | 'dark';

type ThemeSettings = {
  colorScheme: ColorSchemeOption;
  setColorScheme: (value: ColorSchemeOption) => void;
  toggleColorScheme: () => void;
  primaryColor: PrimaryColorOption;
  setPrimaryColor: (value: PrimaryColorOption) => void;
};

const ThemeSettingsContext = createContext<ThemeSettings | null>(null);

export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  const [colorScheme, setColorScheme] = useLocalStorage<ColorSchemeOption>({
    key: 'portal-color-scheme',
    defaultValue: 'light',
  });
  const [primaryColor, setPrimaryColor] = useLocalStorage<PrimaryColorOption>({
    key: 'portal-primary-color',
    defaultValue: 'blue',
  });

  const theme = useMemo(
    () =>
      createTheme({
        primaryColor,
        primaryShade: { light: 6, dark: 8 } satisfies MantinePrimaryShade,
      }),
    [primaryColor],
  );

  const value = useMemo<ThemeSettings>(
    () => ({
      colorScheme,
      setColorScheme,
      toggleColorScheme: () => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark'),
      primaryColor,
      setPrimaryColor,
    }),
    [colorScheme, primaryColor, setColorScheme, setPrimaryColor],
  );

  return (
    <ThemeSettingsContext.Provider value={value}>
      <MantineProvider theme={theme} forceColorScheme={colorScheme}>
        {children}
      </MantineProvider>
    </ThemeSettingsContext.Provider>
  );
}

export function useThemeSettings() {
  const ctx = useContext(ThemeSettingsContext);
  if (!ctx) throw new Error('useThemeSettings must be used within ThemeSettingsProvider');
  return ctx;
}
