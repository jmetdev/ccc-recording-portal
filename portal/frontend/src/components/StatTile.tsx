import { Card, Text } from '@mantine/core';
import type { ReactNode } from 'react';

type Props = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: string;
};

/** Compact KPI tile used on Overview and Storage. */
export function StatTile({ label, value, hint, accent }: Props) {
  return (
    <Card padding="lg" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Text fw={700} mt={6} style={{ fontSize: 28, lineHeight: 1.1, color: accent }}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed" mt={4}>
          {hint}
        </Text>
      )}
    </Card>
  );
}
