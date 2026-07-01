import { createTheme as mantineCreateTheme, type MantineThemeOverride } from '@mantine/core';

export function createTheme(overrides?: MantineThemeOverride) {
  return mantineCreateTheme({
    primaryColor: 'blue',
    defaultRadius: 'md',
    ...overrides,
  });
}
