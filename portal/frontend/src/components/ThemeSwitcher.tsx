import { ActionIcon, Group, Select, Tooltip } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { PRIMARY_COLOR_OPTIONS, useThemeSettings } from '../theme/ThemeSettingsContext';

export function ThemeSwitcher() {
  const { colorScheme, toggleColorScheme, primaryColor, setPrimaryColor } = useThemeSettings();

  return (
    <Group gap="xs">
      <Select
        size="xs"
        w={90}
        aria-label="Accent color"
        data={PRIMARY_COLOR_OPTIONS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
        value={primaryColor}
        onChange={(v) => v && setPrimaryColor(v as typeof primaryColor)}
        comboboxProps={{ withinPortal: true }}
      />
      <Tooltip label={colorScheme === 'dark' ? 'Light mode' : 'Dark mode'}>
        <ActionIcon variant="subtle" onClick={toggleColorScheme} aria-label="Toggle color scheme">
          {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
