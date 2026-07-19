import { createTheme as mantineCreateTheme, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';
import { CloudCoreLogo } from '../components/CloudCoreLogo';
import { SuiteAppCard } from '../components/SuiteAppCard';

const brandBlue: MantineColorsTuple = [
  '#e7f4fd',
  '#cfe6fa',
  '#a1cdf3',
  '#6fb2ed',
  '#469be7',
  '#2c8be4',
  '#1997e4',
  '#0d78bd',
  '#0a689f',
  '#065381',
];

const brandTeal: MantineColorsTuple = [
  '#e4faf6',
  '#c9f2e9',
  '#98e6d4',
  '#63dabe',
  '#3ad0ac',
  '#25c7b5',
  '#20b6a4',
  '#159c8c',
  '#0d8577',
  '#006f62',
];

const brandViolet: MantineColorsTuple = [
  '#f1ecfc',
  '#e0d5f8',
  '#c1abf1',
  '#a181ea',
  '#8760e3',
  '#7a4ddf',
  '#7450d5',
  '#623fbb',
  '#5735a0',
  '#4a2b87',
];

export function createTheme(overrides?: MantineThemeOverride) {
  return mantineCreateTheme({
    fontFamily: 'Manrope, -apple-system, BlinkMacSystemFont, sans-serif',
    fontFamilyMonospace: '"DM Mono", ui-monospace, SFMono-Regular, monospace',
    headings: { fontFamily: 'Manrope, -apple-system, BlinkMacSystemFont, sans-serif' },
    primaryColor: 'brandBlue',
    primaryShade: 6,
    defaultRadius: 'md',
    colors: {
      brandBlue,
      brandTeal,
      brandViolet,
    },
    black: '#0a0a0a',
    components: {
      Card: {
        defaultProps: { withBorder: true },
        styles: {
          root: {
            borderColor: '#e9eaed',
            backgroundColor: '#ffffff',
          },
        },
      },
      Paper: {
        styles: {
          root: {
            borderColor: '#e9eaed',
          },
        },
      },
      Table: {
        defaultProps: { verticalSpacing: 'xs', highlightOnHover: true },
      },
      Badge: {
        defaultProps: { radius: 'sm' },
      },
      CloudCoreLogo: CloudCoreLogo.extend({
        defaultProps: { height: 36 },
      }),
      SuiteAppCard: SuiteAppCard.extend({
        defaultProps: { radius: 14 },
      }),
    },
    ...overrides,
  });
}
