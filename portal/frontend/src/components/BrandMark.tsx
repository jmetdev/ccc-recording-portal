import { Group, Text } from '@mantine/core';
import { IconCloud } from '@tabler/icons-react';
import classes from './BrandMark.module.css';

type Props = {
  size?: number;
  textSize?: number;
  variant?: 'default' | 'onColor';
  iconOnly?: boolean;
};

/** CloudCoreRecord wordmark — shared by the sidebar and the login screen. */
export function BrandMark({ size = 22, textSize, variant = 'default', iconOnly = false }: Props) {
  const onColor = variant === 'onColor';
  const iconColor = onColor ? '#ffffff' : '#1997e4';

  return (
    <Group
      gap={8}
      wrap="nowrap"
      className={iconOnly ? classes.iconOnly : undefined}
      aria-label="CloudCoreRecord"
      role="img"
    >
      <IconCloud size={size} color={iconColor} stroke={1.8} aria-hidden="true" />
      {!iconOnly && (
        <Text
          className={onColor ? classes.brandOnColor : classes.brand}
          style={textSize ? { fontSize: textSize } : undefined}
          aria-hidden="true"
        >
          Cloud
          <span className={onColor ? classes.brandAccentOnColor : classes.brandAccent}>Core</span>
          Record
        </Text>
      )}
    </Group>
  );
}
