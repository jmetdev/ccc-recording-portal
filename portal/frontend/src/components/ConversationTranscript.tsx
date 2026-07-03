import { useEffect, useMemo, useRef } from 'react';
import { Badge, Box, Group, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { Transcript } from '../api/client';
import { FAR_COLOR, NEAR_COLOR } from './DualChannelWaveform';

type Segment = { start: number; end: number; text: string };

type Row = {
  key: string;
  leg: string;
  start: number | null;
  end: number | null;
  text: string;
};

type Props = {
  transcripts: Transcript[];
  nearLabel: string;
  farLabel: string;
  currentTime?: number;
  onSeek?: (time: number) => void;
  maxHeight?: number;
};

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ConversationTranscript({
  transcripts,
  nearLabel,
  farLabel,
  currentTime = 0,
  onSeek,
  maxHeight = 220,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    // Per-leg transcripts give speaker attribution; the stereo transcript
    // duplicates them, so it is only shown when no leg transcript exists.
    const legs = transcripts.filter((t) => t.leg === 'near' || t.leg === 'far');
    const source = legs.length > 0 ? legs : transcripts;

    const out: Row[] = [];
    for (const t of source) {
      const segments = (t.segments_json as Segment[] | null) ?? [];
      const valid = segments.filter(
        (s) => s && typeof s.start === 'number' && typeof s.text === 'string' && s.text.trim() !== '',
      );
      if (valid.length > 0) {
        valid.forEach((s, i) =>
          out.push({ key: `${t.id}-${i}`, leg: t.leg, start: s.start, end: s.end, text: s.text.trim() }),
        );
      } else if (t.text.trim()) {
        out.push({ key: `${t.id}-full`, leg: t.leg, start: null, end: null, text: t.text.trim() });
      }
    }
    return out.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  }, [transcripts]);

  const activeKey = useMemo(() => {
    const active = rows.find(
      (r) => r.start != null && r.end != null && currentTime >= r.start && currentTime < r.end,
    );
    return active?.key ?? null;
  }, [rows, currentTime]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeKey]);

  if (rows.length === 0) return null;

  return (
    <ScrollArea.Autosize mah={maxHeight} viewportRef={viewportRef} type="auto">
      <Stack gap={6} pr="sm">
        {rows.map((row) => {
          const isNear = row.leg === 'near';
          const isFar = row.leg === 'far';
          const color = isNear ? NEAR_COLOR : isFar ? FAR_COLOR : 'var(--mantine-color-gray-6)';
          const speaker = isNear ? nearLabel : isFar ? farLabel : 'both channels';
          const active = row.key === activeKey;
          return (
            <Box
              key={row.key}
              ref={active ? activeRef : undefined}
              style={{
                display: 'flex',
                justifyContent: isFar ? 'flex-end' : 'flex-start',
              }}
            >
              <Paper
                withBorder
                radius="md"
                p={8}
                onClick={row.start != null && onSeek ? () => onSeek(row.start!) : undefined}
                style={{
                  maxWidth: '82%',
                  cursor: row.start != null && onSeek ? 'pointer' : undefined,
                  borderLeft: isFar ? undefined : `3px solid ${color}`,
                  borderRight: isFar ? `3px solid ${color}` : undefined,
                  background: active ? 'var(--mantine-color-blue-light)' : undefined,
                }}
              >
                <Group gap={6} mb={2} justify={isFar ? 'flex-end' : 'flex-start'}>
                  <Badge size="xs" variant="light" style={{ color, borderColor: color }} color="gray">
                    {speaker}
                  </Badge>
                  {row.start != null && (
                    <Text size="xs" c="dimmed">
                      {formatTime(row.start)}
                    </Text>
                  )}
                </Group>
                <Text size="sm" style={{ textAlign: isFar ? 'right' : 'left' }}>
                  {row.text}
                </Text>
              </Paper>
            </Box>
          );
        })}
      </Stack>
    </ScrollArea.Autosize>
  );
}
