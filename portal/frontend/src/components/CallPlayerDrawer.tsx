import { useCallback, useMemo, useState } from 'react';
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
import { api, hasPermission, Transcript } from '../api/client';
import { CallStatusBadge } from './CallStatusBadge';
import { useCallPlayer } from './CallPlayerContext';
import { useAuth } from '../auth/AuthContext';
import { DualChannelWaveform } from './DualChannelWaveform';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CallPlayerDrawer() {
  const { callId, closeCall } = useCallPlayer();
  const { user } = useAuth();
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [regionModal, setRegionModal] = useState<{ start: number; end: number } | null>(null);
  const [tagNote, setTagNote] = useState('');
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [playSignal, setPlaySignal] = useState<number | undefined>();
  const [pauseSignal, setPauseSignal] = useState<number | undefined>();
  const [tagSelectSignal, setTagSelectSignal] = useState(0);

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
  const nearRecording = items.find((r) => r.leg === 'near' && r.path_m4a) ?? null;
  const farRecording = items.find((r) => r.leg === 'far' && r.path_m4a) ?? null;
  const stereoRecording = items.find((r) => r.leg === 'stereo' && r.path_m4a) ?? null;

  const hasNear = !!nearRecording;
  const hasFar = !!farRecording;
  const hasStereo = !!stereoRecording;
  const hasAudio = hasNear || hasFar || hasStereo;

  const tagRecordingId = useMemo(() => {
    if (stereoRecording) return stereoRecording.id;
    if (farRecording) return farRecording.id;
    if (nearRecording) return nearRecording.id;
    return null;
  }, [stereoRecording, farRecording, nearRecording]);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPauseSignal((n) => (n ?? 0) + 1);
    } else {
      setPlaySignal((n) => (n ?? 0) + 1);
    }
  }, [playing]);

  const onSeek = useCallback(
    (value: number) => {
      if (!duration) return;
      setSeekTo((value / 100) * duration);
    },
    [duration],
  );

  const saveTag = async () => {
    if (!regionModal || callId == null || tagRecordingId == null) return;
    await api.createTag({
      call_id: callId,
      recording_id: tagRecordingId,
      channel: hasNear && hasFar ? 'mix' : 'mix',
      start_s: regionModal.start,
      end_s: regionModal.end,
      note: tagNote || null,
    });
    setRegionModal(null);
    setTagNote('');
    await tags.refetch();
  };

  if (callId == null) return null;

  const tagList = tags.data ?? [];
  const transcriptList = transcripts.data ?? [];
  const nearLabel = call.data?.near_name || call.data?.near_addr || 'agent';
  const farLabel = call.data?.far_name || call.data?.far_addr || 'remote';

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
                Near: {nearLabel} · Far: {farLabel}
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
              </Group>
            </Box>
            <ActionIcon variant="subtle" onClick={closeCall} aria-label="Close player">
              <IconX size={18} />
            </ActionIcon>
          </Group>

          {hasAudio ? (
            <DualChannelWaveform
              nearRecording={nearRecording}
              farRecording={farRecording}
              stereoRecording={stereoRecording}
              audioUrl={api.audioUrl}
              nearLabel={nearLabel}
              farLabel={farLabel}
              tags={tagList}
              canTag={canManageTags}
              onRegionSelected={(start, end) => setRegionModal({ start, end })}
              onTimeUpdate={setCurrentTime}
              onDuration={setDuration}
              onPlayingChange={setPlaying}
              seekTo={seekTo}
              playSignal={playSignal}
              pauseSignal={pauseSignal}
              tagSelectSignal={tagSelectSignal}
            />
          ) : (
            <Text size="sm" c="dimmed">
              {recordings.isLoading ? 'Loading recordings…' : 'Recording not ready yet'}
            </Text>
          )}

          <Group gap="sm" wrap="nowrap">
            <ActionIcon
              variant="light"
              size="lg"
              onClick={togglePlay}
              disabled={!hasAudio}
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
              disabled={!hasAudio || !duration}
              size="xs"
              label={null}
            />
            <Text size="xs" c="dimmed" style={{ width: 44, textAlign: 'right' }}>
              {formatTime(duration)}
            </Text>
            {canManageTags && hasAudio && (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconTag size={14} />}
                onClick={() => setTagSelectSignal((n) => n + 1)}
              >
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
                    onClick={() => setSeekTo(t.start_s)}
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

export const CALL_PLAYER_DRAWER_MIN_HEIGHT = 280;
