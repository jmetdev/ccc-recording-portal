import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Slider,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay, IconTag, IconX } from '@tabler/icons-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { api, authHeaders, hasPermission, Tag, Transcript } from '../api/client';
import { CallStatusBadge } from './CallStatusBadge';
import { useCallPlayer } from './CallPlayerContext';
import { useAuth } from '../auth/AuthContext';

const NEAR_COLOR = '#2b87d4';
const FAR_COLOR = '#43a3eb';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}


export function CallPlayerDrawer() {
  const { callId, closeCall } = useCallPlayer();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [regionModal, setRegionModal] = useState<{ start: number; end: number } | null>(null);
  const [tagNote, setTagNote] = useState('');

  const canManageTags = hasPermission(user, 'manage_tags');
  const canViewTranscripts = hasPermission(user, 'view_transcripts');

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
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      const pending = items.some((r) => r.path_m4a == null);
      return pending ? 3000 : false;
    },
  });

  const tags = useQuery({
    queryKey: ['tags', callId],
    queryFn: () => api.listTags(callId!),
    enabled: callId != null,
  });

  const transcripts = useQuery({
    queryKey: ['transcripts', callId],
    queryFn: () => api.listTranscripts(callId!),
    enabled: callId != null && canViewTranscripts,
    refetchInterval: call.data?.status === 'transcribing' ? 3000 : false,
  });

  const items = recordings.data ?? [];
  const hasNear = items.some((r) => r.leg === 'near' && r.path_m4a);
  const hasFar = items.some((r) => r.leg === 'far' && r.path_m4a);
  const hasStereo = items.some((r) => r.leg === 'stereo' && r.path_m4a);

  const playback = useMemo(() => {
    if (!hasNear) {
      return (
        items.find((r) => r.leg === 'stereo' && r.path_m4a) ??
        items.find((r) => r.leg === 'far' && r.path_m4a) ??
        items.find((r) => r.leg === 'near' && r.path_m4a) ??
        null
      );
    }
    return (
      items.find((r) => r.leg === 'stereo' && r.path_m4a) ??
      items.find((r) => r.leg === 'far' && r.path_m4a) ??
      items.find((r) => r.leg === 'near' && r.path_m4a) ??
      null
    );
  }, [items, hasNear]);

  const useSplitChannels = playback?.leg === 'stereo' && hasNear;

  const renderTagRegions = useCallback(
    (regions: ReturnType<typeof RegionsPlugin.create>, tagList: Tag[]) => {
      regions.clearRegions();
      tagList.forEach((t) => {
        regions.addRegion({
          start: t.start_s,
          end: t.end_s,
          color: 'rgba(43, 135, 212, 0.25)',
          content: t.note || undefined,
          drag: false,
          resize: false,
        });
      });
    },
    [],
  );

  useEffect(() => {
    if (!callId || !playback?.path_m4a || !containerRef.current) return;

    containerRef.current.replaceChildren();

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

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
            { overlay: false, waveColor: NEAR_COLOR, progressColor: '#195184' },
            { overlay: false, waveColor: FAR_COLOR, progressColor: '#226cac' },
          ]
        : undefined,
      normalize: true,
      plugins: [regions],
    });
    wsRef.current = ws;

    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('timeupdate', (t) => setCurrentTime(t));
    ws.on('ready', () => {
      setDuration(ws.getDuration());
      if (tags.data) renderTagRegions(regions, tags.data);
    });

    if (canManageTags) {
      regions.on('region-created', (region) => {
        setRegionModal({ start: region.start, end: region.end });
        region.remove();
      });
    }

    return () => {
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [callId, playback?.id, playback?.path_m4a, playback?.leg, useSplitChannels, canManageTags, renderTagRegions]);

  useEffect(() => {
    if (regionsRef.current && tags.data) {
      renderTagRegions(regionsRef.current, tags.data);
    }
  }, [tags.data, renderTagRegions]);

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

  const enableTagSelection = () => {
    regionsRef.current?.enableDragSelection({ color: 'rgba(43, 135, 212, 0.3)' });
  };

  const saveTag = async () => {
    if (!regionModal || !playback || callId == null) return;
    await api.createTag({
      call_id: callId,
      recording_id: playback.id,
      channel: useSplitChannels ? 'mix' : playback.leg,
      start_s: regionModal.start,
      end_s: regionModal.end,
      note: tagNote || null,
    });
    setRegionModal(null);
    setTagNote('');
    await tags.refetch();
  };

  const seekTo = (seconds: number) => {
    wsRef.current?.setTime(seconds);
  };

  if (callId == null) return null;

  const tagList = tags.data ?? [];
  const transcriptList = transcripts.data ?? [];

  return (
    <>
      <Paper
        shadow="lg"
        radius={0}
        withBorder
        style={{
          position: 'fixed',
          left: 'var(--app-shell-navbar-width, 0px)',
          right: 0,
          bottom: 0,
          zIndex: 200,
          borderLeft: 0,
          borderRight: 0,
          borderBottom: 0,
          maxHeight: '70vh',
          overflow: 'auto',
        }}
      >
        <Stack gap="xs" p="md" pb="sm">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Group gap="xs" wrap="wrap">
                <Text fw={600}>Call #{callId}</Text>
                {call.data?.refci && <Badge variant="light">{call.data.refci}</Badge>}
                <CallStatusBadge status={call.data?.status} />
                {call.data?.sentiment && (
                  <Badge variant="outline" color="gray">
                    {call.data.sentiment}
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                Near: {call.data?.near_name || call.data?.near_addr || '—'} · Far:{' '}
                {call.data?.far_name || call.data?.far_addr || '—'}
                {call.data?.duration_s != null ? ` · ${Math.round(call.data.duration_s)}s` : ''}
              </Text>
              <Group gap={6} mt={6}>
                <Badge size="xs" color={hasNear ? 'blue' : 'gray'} variant={hasNear ? 'filled' : 'light'}>
                  Near leg {hasNear ? '✓' : '—'}
                </Badge>
                <Badge size="xs" color={hasFar ? 'blue' : 'gray'} variant={hasFar ? 'filled' : 'light'}>
                  Far leg {hasFar ? '✓' : '—'}
                </Badge>
                <Badge size="xs" color={hasStereo ? 'blue' : 'gray'} variant={hasStereo ? 'filled' : 'light'}>
                  Stereo {hasStereo ? '✓' : '—'}
                </Badge>
                {!hasNear && hasFar && (
                  <Text size="xs" c="orange">
                    Near-end audio not received — check CUCM BIB near-leg fork / endpoint RTP
                  </Text>
                )}
              </Group>
            </Box>
            <ActionIcon variant="subtle" onClick={closeCall} aria-label="Close player">
              <IconX size={18} />
            </ActionIcon>
          </Group>

          <Box
            ref={containerRef}
            style={{ height: useSplitChannels ? 120 : 96, overflow: 'hidden', position: 'relative', isolation: 'isolate' }}
          />
          {useSplitChannels && (
            <Group gap="md">
              <Text size="xs" c={NEAR_COLOR}>
                ■ Near ({call.data?.near_addr || 'agent'})
              </Text>
              <Text size="xs" c={FAR_COLOR}>
                ■ Far ({call.data?.far_addr || 'remote'})
              </Text>
            </Group>
          )}

          {!playback && <Text size="sm" c="dimmed">Recording not ready yet</Text>}
          {playback && !playback.path_m4a && <Text size="sm" c="dimmed">Audio is still converting…</Text>}

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
            {canManageTags && playback?.path_m4a && (
              <Button size="xs" variant="light" leftSection={<IconTag size={14} />} onClick={enableTagSelection}>
                Tag region
              </Button>
            )}
            <Button size="xs" variant="default" onClick={closeCall}>
              Close
            </Button>
          </Group>

          {tagList.length > 0 && (
            <ScrollArea.Autosize mah={80}>
              <Group gap={6}>
                {tagList.map((t) => (
                  <Badge
                    key={t.id}
                    variant="light"
                    style={{ cursor: 'pointer' }}
                    onClick={() => seekTo(t.start_s)}
                    title={t.note || undefined}
                  >
                    {formatTime(t.start_s)}–{formatTime(t.end_s)}
                    {t.note ? `: ${t.note}` : ''}
                  </Badge>
                ))}
              </Group>
            </ScrollArea.Autosize>
          )}

          {canViewTranscripts && (
            <Box>
              <Text size="sm" fw={600} mb={4}>
                Transcription
              </Text>
              {transcripts.isLoading && <Text size="sm" c="dimmed">Loading…</Text>}
              {call.data?.status === 'transcribing' && (
                <Text size="sm" c="dimmed">Transcription in progress…</Text>
              )}
              {!transcripts.isLoading && transcriptList.length === 0 && call.data?.status === 'completed' && (
                <Text size="sm" c="dimmed">No transcript available for this call.</Text>
              )}
              {transcriptList.length > 0 && (
                <ScrollArea.Autosize mah={140}>
                  <Stack gap="xs">
                    {transcriptList.map((t: Transcript) => (
                      <Paper key={t.id} withBorder p="xs" radius="sm">
                        <Group gap="xs" mb={4}>
                          <Badge size="xs" variant="outline">
                            {t.leg}
                          </Badge>
                          {t.sentiment && (
                            <Badge size="xs" color="gray" variant="light">
                              {t.sentiment}
                            </Badge>
                          )}
                        </Group>
                        <Text size="sm">{t.text}</Text>
                      </Paper>
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              )}
            </Box>
          )}
        </Stack>
      </Paper>

      <Modal opened={!!regionModal} onClose={() => setRegionModal(null)} title="Tag region">
        {regionModal && (
          <Text size="sm" c="dimmed" mb="sm">
            {formatTime(regionModal.start)} – {formatTime(regionModal.end)}
          </Text>
        )}
        <Textarea
          label="Note"
          value={tagNote}
          onChange={(e) => setTagNote(e.currentTarget.value)}
          mb="md"
          autosize
          minRows={2}
        />
        <Button onClick={saveTag}>Save tag</Button>
      </Modal>
    </>
  );
}

export const CALL_PLAYER_DRAWER_MIN_HEIGHT = 220;
