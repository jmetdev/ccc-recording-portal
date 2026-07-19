import { Group, Text } from '@mantine/core';
import { IconCloud } from '@tabler/icons-react';
import classes from './BrandMark.module.css';

type Props = {
  size?: number;
  textSize?: number;
};

/** Suite wordmark — CloudCoreCollab (not the Record product mark). */
export function SuiteBrandMark({ size = 22, textSize }: Props) {
  return (
    <Group gap={8} wrap="nowrap" aria-label="CloudCoreCollab" role="img">
      <IconCloud size={size} color="#1997e4" stroke={1.8} aria-hidden="true" />
      <Text className={classes.brand} style={textSize ? { fontSize: textSize } : undefined} aria-hidden="true">
        Cloud<span className={classes.brandAccent}>Core</span>Collab
      </Text>
    </Group>
  );
}
