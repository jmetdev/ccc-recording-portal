import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Box, Button, Group, Paper, Slider, Stack, Text } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay, IconX } from '@tabler/icons-react';
import WaveSurfer from 'wavesurfer.js';
import { api, authHeaders } from '../api/client';
import { CallStatusBadge } from './CallStatusBadge';
import { useCallPlayer } from './CallPlayerContext';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CallPlayerDrawer() {
  const { callId, closeCall } = useCallPlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const call = useQuery({
    queryKey: ['call', callId],
    queryFn: () => api.getCall(callId!),
    enabled: callId != null,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'processing' || s === 'transcribing' ? 3000 : false;
    },
  });

  const recordings = useQuery({
    queryKey: ['recordings', callId],
    queryFn: () => api.getRecordings(callId!),
    enabled: callId != null,
  });

  const playback = useMemo(() => {
    const items = recordings.data ?? [];
    const hasNear = items.some((r) => r.leg === 'near' && r.path_m4a);
    if (!hasNear) {
      return (
        items.find((r) => r.leg === 'far' && r.path_m4a) ??
        items.find((r) => r.leg === 'near' && r.path_m4a) ??
        items.find((r) => r.leg === 'stereo' && r.path_m4a) ??
        null
      );
    }
    return (
      items.find((r) => r.leg === 'stereo' && r.path_m4a) ??
      items.find((r) => r.leg === 'far' && r.path_m4a) ??
      items.find((r) => r.leg === 'near' && r.path_m4a) ??
      null
    );
  }, [recordings.data]);

  const useSplitChannels =
    playback?.leg === 'stereo' && (recordings.data ?? []).some((r) => r.leg === 'near' && r.path_m4a);

  useEffect(() => {
    if (!callId || !playback?.path_m4a || !containerRef.current) return;

    containerRef.current.replaceChildren();

    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: api.audioUrl(playback.id),
      fetchParams: { headers: authHeaders() },
      waveColor: '#128feb',
      progressColor: '#0a558d',
      height: 96,
      barWidth: 2,
      splitChannels: useSplitChannels
        ? [
            { overlay: false, waveColor: '#2b87d4', progressColor: '#195184' },
            { overlay: false, waveColor: '#43a3eb', progressColor: '#226cac' },
          ]
        : undefined,
      normalize: true,
    });
    wsRef.current = ws;

    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('timeupdate', (t) => setCurrentTime(t));
    ws.on('ready', () => setDuration(ws.getDuration()));

    return () => {
      ws.destroy();
      wsRef.current = null;
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [callId, playback?.id, playback?.path_m4a, playback?.leg, useSplitChannels]);

  const togglePlay = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const onSeek = useCallback(
    (value: number) => {
      const ws = wsRef.current;
      if (!ws || !duration) return;
      ws.setTime((value / 100) * duration);
    },
    [duration],
  );

  if (callId == null) return null;

  return (
    <Paper
      shadow="lg"
      radius={0}
      withBorder
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 200,
        borderLeft: 0,
        borderRight: 0,
        borderBottom: 0,
      }}
    >
      <Stack gap="xs" p="md" pb="sm">
        <Group justify="space-between" wrap="nowrap">
          <Box style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <Text fw={600} truncate>
                Call #{callId}
                {call.data?.refci ? ` · ${call.data.refci}` : ''}
              </Text>
              <CallStatusBadge status={call.data?.status} />
            </Group>
            <Text size="sm" c="dimmed" truncate>
              {call.data?.near_name || call.data?.near_addr || '?'} ↔{' '}
              {call.data?.far_name || call.data?.far_addr || '?'}
              {call.data?.duration_s != null ? ` · ${Math.round(call.data.duration_s)}s` : ''}
            </Text>
          </Box>
          <ActionIcon variant="subtle" onClick={closeCall} aria-label="Close player">
            <IconX size={18} />
          </ActionIcon>
        </Group>

        <Box
          ref={containerRef}
          style={{ height: 96, overflow: 'hidden', position: 'relative', isolation: 'isolate' }}
        />

        {!playback && <Text size="sm" c="dimmed">Recording not ready yet</Text>}
        {playback && !playback.path_m4a && <Text size="sm" c="dimmed">Audio is still converting…</Text>}
        {playback && !useSplitChannels && (
          <Text size="xs" c="dimmed">Far-end only — near leg not received from CUCM</Text>
        )}

        <Group gap="sm" wrap="nowrap">
          <ActionIcon
            variant="light"
            size="lg"
            onClick={togglePlay}
            disabled={!playback?.path_m4a}
            aria-label="Play or pause"
          >
            {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
          </ActionIcon>
          <Text size="xs" c="dimmed" style={{ width: 44 }}>
            {formatTime(currentTime)}
          </Text>
          <Slider
            style={{ flex: 1 }}
            value={duration ? (currentTime / duration) * 100 : 0}
            onChange={onSeek}
            disabled={!playback?.path_m4a || !duration}
            size="xs"
            label={null}
          />
          <Text size="xs" c="dimmed" style={{ width: 44, textAlign: 'right' }}>
            {formatTime(duration)}
          </Text>
          <Button size="xs" variant="default" onClick={closeCall}>
            Close
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
