import type { ReactNode } from 'react';
import { Badge, type BadgeProps } from '@mantine/core';
import {
  IconCheck,
  IconCircleFilled,
  IconLoader2,
  IconMicrophone,
  IconX,
} from '@tabler/icons-react';
import classes from './CallStatusBadge.module.css';

export type CallStatusValue =
  | 'recording'
  | 'processing'
  | 'transcribing'
  | 'completed'
  | 'failed'
  | string;

type StatusConfig = {
  label: string;
  color: string;
  icon: ReactNode;
};

function configFor(status: string): StatusConfig {
  switch (status) {
    case 'recording':
      return {
        label: 'Recording',
        color: 'red',
        icon: <IconCircleFilled size={10} className={`${classes.badgeIcon} ${classes.pulse}`} />,
      };
    case 'processing':
      return {
        label: 'Processing',
        color: 'cyan',
        icon: <IconLoader2 size={12} className={`${classes.badgeIcon} ${classes.spin}`} />,
      };
    case 'transcribing':
      return {
        label: 'Transcribing',
        color: 'teal',
        icon: <IconMicrophone size={12} className={classes.badgeIcon} />,
      };
    case 'completed':
      return {
        label: 'Complete',
        color: 'blue',
        icon: <IconCheck size={12} className={classes.badgeIcon} />,
      };
    case 'failed':
      return {
        label: 'Failed',
        color: 'red',
        icon: <IconX size={12} className={classes.badgeIcon} />,
      };
    default:
      return {
        label: status.replace(/_/g, ' '),
        color: 'gray',
        icon: null,
      };
  }
}

type Props = BadgeProps & {
  status: CallStatusValue | null | undefined;
};

export function CallStatusBadge({ status, size = 'sm', ...rest }: Props) {
  if (!status) return null;
  const cfg = configFor(status);
  return (
    <Badge
      size={size}
      color={cfg.color}
      variant="light"
      leftSection={cfg.icon}
      {...rest}
    >
      {cfg.label}
    </Badge>
  );
}
