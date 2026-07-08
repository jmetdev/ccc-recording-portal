import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  ScrollArea,
  Slider,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconArrowLeft, IconPlayerPause, IconPlayerPlay, IconTag } from '@tabler/icons-react';
import { api, hasPermission, recordingHasMedia } from '../api/client';
import { CallStatusBadge } from '../components/CallStatusBadge';
import { SourceBadge } from '../components/SourceBadge';
import { useAuth } from '../auth/AuthContext';
import { DualChannelWaveform } from '../components/DualChannelWaveform';
import { ConversationTranscript } from '../components/ConversationTranscript';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
};

export function CallDetailPage() {
  const { id } = useParams();
  const callId = Number(id) || null;
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
      return s === 'recording' || s === 'processing' || s === 'transcribing' ? 3000 : false;
    },
  });

  const recordings = useQuery({
    queryKey: ['recordings', callId],
    queryFn: () => api.getRecordings(callId!),
    enabled: callId != null,
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      const pending = items.length === 0 || items.some((r) => !recordingHasMedia(r));
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
  const nearRecording = items.find((r) => r.leg === 'near' && recordingHasMedia(r)) ?? null;
  const farRecording = items.find((r) => r.leg === 'far' && recordingHasMedia(r)) ?? null;
  const stereoRecording = items.find((r) => r.leg === 'stereo' && recordingHasMedia(r)) ?? null;
  // Cloud sources (Webex) deliver one muxed single-channel file.
  const mixRecording = items.find((r) => r.leg === 'mix' && recordingHasMedia(r)) ?? null;
  const hasAudio = !!(nearRecording || farRecording || stereoRecording || mixRecording);

  const tagRecordingId = useMemo(() => {
    if (stereoRecording) return stereoRecording.id;
    if (mixRecording) return mixRecording.id;
    if (farRecording) return farRecording.id;
    if (nearRecording) return nearRecording.id;
    return null;
  }, [stereoRecording, mixRecording, farRecording, nearRecording]);

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
      channel: 'mix',
      start_s: regionModal.start,
      end_s: regionModal.end,
      note: tagNote || null,
    });
    setRegionModal(null);
    setTagNote('');
    await tags.refetch();
  };

  if (callId == null) return <Text c="dimmed">Call not found.</Text>;

  const tagList = tags.data ?? [];
  const transcriptList = transcripts.data ?? [];
  const nearLabel = call.data?.near_name || call.data?.near_addr || 'near';
  const farLabel = call.data?.far_name || call.data?.far_addr || 'far';
  const status = call.data?.status;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <ActionIcon component={Link} to="/calls" variant="subtle" size="lg" aria-label="Back to call search">
            <IconArrowLeft size={20} />
          </ActionIcon>
          <Box>
            <Group gap="xs" wrap="wrap">
              <Title order={3}>Call #{callId}</Title>
              {call.data?.source && <SourceBadge source={call.data.source} />}
              {call.data?.refci && <Badge variant="light">{call.data.refci}</Badge>}
              {status === 'failed' && call.data?.status_message ? (
                <Tooltip label={call.data.status_message} maw={360} multiline withArrow>
                  <span>
                    <CallStatusBadge status={status} />
                  </span>
                </Tooltip>
              ) : (
                <CallStatusBadge status={status} />
              )}
              {call.data?.sentiment && (
                <Badge variant="light" color={SENTIMENT_COLORS[call.data.sentiment] ?? 'gray'}>
                  {call.data.sentiment}
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              Near: {nearLabel} · Far: {farLabel}
              {call.data?.duration_s != null ? ` · ${formatTime(call.data.duration_s)}` : ''}
              {call.data?.started_at ? ` · ${new Date(call.data.started_at).toLocaleString()}` : ''}
            </Text>
          </Box>
        </Group>
      </Group>

      <Card withBorder padding="md">
        {hasAudio ? (
          <Stack gap="sm">
            <DualChannelWaveform
              nearRecording={nearRecording}
              farRecording={farRecording}
              stereoRecording={stereoRecording}
              mixRecording={mixRecording}
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
            <Group gap="sm" wrap="nowrap">
              <ActionIcon
                variant="filled"
                size="xl"
                radius="xl"
                onClick={togglePlay}
                aria-label="Play or pause"
              >
                {playing ? <IconPlayerPause size={22} /> : <IconPlayerPlay size={22} />}
              </ActionIcon>
              <Text size="xs" c="dimmed" style={{ width: 44 }}>
                {formatTime(currentTime)}
              </Text>
              <Slider
                style={{ flex: 1 }}
                value={duration ? (currentTime / duration) * 100 : 0}
                onChange={onSeek}
                disabled={!duration}
                size="sm"
                label={(v) => (duration ? formatTime((v / 100) * duration) : null)}
              />
              <Text size="xs" c="dimmed" style={{ width: 44, textAlign: 'right' }}>
                {formatTime(duration)}
              </Text>
              {canManageTags && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconTag size={14} />}
                  onClick={() => setTagSelectSignal((n) => n + 1)}
                >
                  Tag region
                </Button>
              )}
            </Group>
            {tagList.length > 0 && (
              <ScrollArea.Autosize mah={64}>
                <Group gap={6}>
                  {tagList.map((t) => (
                    <Badge
                      key={t.id}
                      variant="light"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSeekTo(t.start_s + Math.random() * 1e-6)}
                      title={t.note || undefined}
                    >
                      {formatTime(t.start_s)}–{formatTime(t.end_s)}
                      {t.note ? `: ${t.note}` : ''}
                    </Badge>
                  ))}
                </Group>
              </ScrollArea.Autosize>
            )}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            {recordings.isLoading
              ? 'Loading recordings…'
              : status === 'recording'
                ? 'Call is being recorded…'
                : status === 'processing'
                  ? 'Recording is being processed…'
                  : 'No audio available for this call.'}
          </Text>
        )}
      </Card>

      {canViewTranscripts && (
        <Card withBorder padding="md">
          <Text fw={600} mb="xs">
            Transcription
          </Text>
          {transcripts.isLoading && <Text size="sm" c="dimmed">Loading…</Text>}
          {status === 'transcribing' && <Text size="sm" c="dimmed">Transcription in progress…</Text>}
          {!transcripts.isLoading && transcriptList.length === 0 && status === 'completed' && (
            <Text size="sm" c="dimmed">No transcript available for this call.</Text>
          )}
          <ConversationTranscript
            transcripts={transcriptList}
            nearLabel={nearLabel}
            farLabel={farLabel}
            currentTime={currentTime}
            onSeek={(t) => setSeekTo(t + Math.random() * 1e-6)}
            maxHeight={480}
          />
        </Card>
      )}

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
    </Stack>
  );
}
