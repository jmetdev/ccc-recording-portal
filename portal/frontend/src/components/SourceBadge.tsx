import { Badge, type BadgeProps } from '@mantine/core';

export type CallSourceValue = 'cucm' | 'webex' | string;

type SourceConfig = { label: string; color: string };

function configFor(source: string): SourceConfig {
  switch (source.toLowerCase()) {
    case 'cucm':
      return { label: 'CUCM', color: 'violet' };
    case 'webex':
      return { label: 'Webex', color: 'teal' };
    default:
      return { label: source, color: 'gray' };
  }
}

type Props = BadgeProps & {
  source: CallSourceValue | null | undefined;
};

/** Distinguishes on-prem (CUCM) from cloud (Webex) recordings — mixed
 * deployments show both within the same tenant. */
export function SourceBadge({ source, size = 'sm', ...rest }: Props) {
  if (!source) return null;
  const cfg = configFor(source);
  return (
    <Badge size={size} color={cfg.color} variant="light" {...rest}>
      {cfg.label}
    </Badge>
  );
}
