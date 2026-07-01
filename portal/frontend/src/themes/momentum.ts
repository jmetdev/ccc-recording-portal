import { createTheme, MantineColorsTuple } from '@mantine/core';

const momentumBlue: MantineColorsTuple = [
  '#e8f4fd', '#d0e8fa', '#a1d1f5', '#72baf0', '#43a3eb',
  '#2b87d4', '#226cac', '#195184', '#10365c', '#081b34',
];

export const momentumTheme = createTheme({
  primaryColor: 'momentum',
  colors: {
    momentum: momentumBlue,
  },
  fontFamily: 'CiscoSans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  headings: {
    fontFamily: 'CiscoSans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  },
  defaultRadius: 'md',
});
