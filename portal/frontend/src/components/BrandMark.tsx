import { Group } from '@mantine/core';
import { IconCloud } from '@tabler/icons-react';
import classes from './BrandMark.module.css';

type Props = {
  size?: number;
  textSize?: number;
  variant?: 'default' | 'onColor';
  iconOnly?: boolean;
};

function OnColorCloud({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={classes.cloudSvg}
    >
      <path
        d="M7.5 18h9.2a3.8 3.8 0 0 0 .35-7.58A5.25 5.25 0 0 0 7.1 8.4 3.75 3.75 0 0 0 7.5 18z"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        fill="rgba(255, 255, 255, 0.13)"
      />
    </svg>
  );
}

/** CloudCoreRecord wordmark — shared by the sidebar and the login screen. */
export function BrandMark({ size = 22, textSize, variant = 'default', iconOnly = false }: Props) {
  const onColor = variant === 'onColor';

  return (
    <Group
      gap={onColor ? 12 : 8}
      wrap="nowrap"
      className={iconOnly ? classes.iconOnly : classes.brandWrap}
      aria-label="CloudCoreRecord"
      role="img"
    >
      {onColor ? (
        <OnColorCloud size={size} />
      ) : (
        <IconCloud size={size} color="#1997e4" stroke={1.8} aria-hidden="true" />
      )}
      {!iconOnly && (
        <span
          className={onColor ? classes.brandOnColor : classes.brand}
          style={
            textSize
              ? { fontSize: textSize, fontWeight: 700, letterSpacing: '-0.02em' }
              : undefined
          }
          aria-hidden="true"
        >
          Cloud<span className={onColor ? classes.brandAccentOnColor : classes.brandAccent}>Core</span>
          Record
        </span>
      )}
    </Group>
  );
}
