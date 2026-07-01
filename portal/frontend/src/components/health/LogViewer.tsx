import { Badge, Box, Text } from '@mantine/core';
import classes from './LogViewer.module.css';

type Props = {
  lines: string[];
};

function lineClass(line: string) {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('failed') || lower.includes('bib-hangup-hook')) {
    return classes.logLineError;
  }
  if (lower.includes('warn') || lower.includes('notice')) {
    return classes.logLineWarn;
  }
  if (lower.includes('info') || lower.includes('start refci') || lower.includes('hangup refci')) {
    return classes.logLineInfo;
  }
  return undefined;
}

export function LogViewer({ lines }: Props) {
  return (
    <Box className={classes.logPanel}>
      {lines.map((line, index) => (
        <Text key={`${index}-${line.slice(0, 24)}`} className={`${classes.logLine} ${lineClass(line) ?? ''}`}>
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}

export function containerStateColor(state: string) {
  switch (state) {
    case 'healthy':
      return 'teal';
    case 'starting':
      return 'yellow';
    case 'unhealthy':
      return 'orange';
    case 'down':
      return 'red';
    default:
      return 'gray';
  }
}

export function overallColor(overall: string) {
  switch (overall) {
    case 'healthy':
      return 'teal';
    case 'degraded':
      return 'yellow';
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}

export function StageBadge({ stage }: { stage: string }) {
  const color =
    stage === 'ingest' ? 'orange' : stage === 'worker' ? 'red' : stage === 'recording' ? 'yellow' : 'gray';
  return (
    <Badge size="sm" variant="light" color={color}>
      {stage}
    </Badge>
  );
}
