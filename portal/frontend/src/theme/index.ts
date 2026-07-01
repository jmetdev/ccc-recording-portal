import { createTheme, MantineColorsTuple } from '@mantine/core';

const webexBlue: MantineColorsTuple = [
  '#e8f4fd',
  '#d0e9fb',
  '#a1d3f7',
  '#71bdf3',
  '#42a7ef',
  '#128feb',
  '#0e72bc',
  '#0a558d',
  '#07395e',
  '#031c2f',
];

export const theme = createTheme({
  primaryColor: 'webexBlue',
  colors: {
    webexBlue,
  },
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  headings: {
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  },
  defaultRadius: 'md',
});
