import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Group,
  Modal,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconDownload,
  IconInfoCircle,
  IconLock,
  IconMail,
  IconMailOpened,
  IconPlayerPause,
  IconPlayerPlay,
  IconRestore,
  IconTag,
  IconTrash,
} from '@tabler/icons-react';
import { api, hasPermission, recordingHasMedia } from '../../api/client';
import { CallStatusBadge } from '../../components/CallStatusBadge';
import { SourceBadge } from '../../components/SourceBadge';
import { useAuth } from '../../auth/AuthContext';
import { DualChannelWaveform } from '../../components/DualChannelWaveform';
import { ConversationTranscript } from '../../components/ConversationTranscript';
import { formatParty } from '../../utils/partyLabel';
import {
  SENTIMENT_COLORS,
  TRASH_RETENTION_DAYS,
  callTitle,
  daysUntilTrashPurge,
  formatTime,
} from './recordingsShared';
import classes from './Recordings.module.css';

export function RecordingDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const callId = Number(id);
  const trashOnly = searchParams.get('trashed') === 'true';

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [regionModal, setRegionModal] = useState<{ start: number; end: number } | null>(null);
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
  const [tagNote, setTagNote] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [playSignal, setPlaySignal] = useState<number | undefined>();
  const [pauseSignal, setPauseSignal] = useState<number | undefined>();
  const [tagSelectSignal, setTagSelectSignal] = useState(0);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const markedReadForCall = useRef<number | null>(null);

  const canManageTags = hasPermission(user, 'manage_tags');
  const canViewTranscripts = hasPermission(user, 'view_transcripts');
  const canManageRetention = hasPermission(user, 'manage_retention');

  const call = useQuery({
    queryKey: ['call', callId],
    queryFn: () => api.getCall(callId),
    enabled: Number.isFinite(callId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'recording' || s === 'processing' || s === 'transcribing' ? 3000 : false;
    },
  });

  useEffect(() => {
    if (call.data && !notesDirty) {
      setNotesDraft(call.data.notes ?? '');
    }
  }, [call.data, notesDirty]);

  useEffect(() => {
    markedReadForCall.current = null;
    setNotesDirty(false);
  }, [callId]);

  useEffect(() => {
    if (!call.data || call.isError) return;
    if (!call.data.is_unread) return;
    if (markedReadForCall.current === callId) return;
    markedReadForCall.current = callId;
    void (async () => {
      try {
        await api.markCallRead(callId);
        await queryClient.invalidateQueries({ queryKey: ['calls'] });
        queryClient.setQueryData(['call', callId], (prev: typeof call.data) =>
          prev ? { ...prev, is_unread: false } : prev,
        );
      } catch {
        markedReadForCall.current = null;
      }
    })();
  }, [call.data, call.isError, callId, queryClient]);

  const recordings = useQuery({
    queryKey: ['recordings', callId],
    queryFn: () => api.getRecordings(callId),
    enabled: Number.isFinite(callId),
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      const hasPlayable = items.some(
        (r) =>
          recordingHasMedia(r) &&
          (r.leg === 'stereo' || r.leg === 'mix' || r.leg === 'near' || r.leg === 'far'),
      );
      return hasPlayable ? false : 3000;
    },
  });

  const tags = useQuery({
    queryKey: ['tags', callId],
    queryFn: () => api.listTags(callId),
    enabled: Number.isFinite(callId),
  });

  const transcripts = useQuery({
    queryKey: ['transcripts', callId],
    queryFn: () => api.listTranscripts(callId),
    enabled: Number.isFinite(callId) && canViewTranscripts,
    refetchInterval: call.data?.status === 'transcribing' ? 3000 : false,
  });

  const legalHold = useMutation({
    mutationFn: (value: boolean) => api.setLegalHold(callId, value),
    onSuccess: () => call.refetch(),
  });

  const saveNotes = useMutation({
    mutationFn: () => api.patchCallNotes(callId, notesDraft || null),
    onSuccess: (updated) => {
      queryClient.setQueryData(['call', callId], updated);
      setNotesDirty(false);
    },
  });

  const trashCall = useMutation({
    mutationFn: () => api.trashCall(callId),
    onSuccess: async () => {
      setTrashConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['calls'] });
      navigate('/recordings?trashed=true');
    },
  });

  const restoreCall = useMutation({
    mutationFn: () => api.restoreCall(callId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calls'] });
      await queryClient.invalidateQueries({ queryKey: ['call', callId] });
      navigate(`/recordings/${callId}`);
    },
  });

  const markUnread = useMutation({
    mutationFn: () => api.markCallUnread(callId),
    onSuccess: async () => {
      markedReadForCall.current = callId;
      await queryClient.invalidateQueries({ queryKey: ['calls'] });
      queryClient.setQueryData(['call', callId], (prev: typeof call.data) =>
        prev ? { ...prev, is_unread: true } : prev,
      );
    },
  });

  const items = recordings.data ?? [];
  const nearRecording = items.find((r) => r.leg === 'near' && recordingHasMedia(r)) ?? null;
  const farRecording = items.find((r) => r.leg === 'far' && recordingHasMedia(r)) ?? null;
  const stereoRecording = items.find((r) => r.leg === 'stereo' && recordingHasMedia(r)) ?? null;
  const mixRecording = items.find((r) => r.leg === 'mix' && recordingHasMedia(r)) ?? null;
  const hasAudio = !!(nearRecording || farRecording || stereoRecording || mixRecording);
  const downloadRecording =
    stereoRecording || mixRecording || farRecording || nearRecording || null;

  const tagRecordingId = useMemo(() => {
    if (stereoRecording) return stereoRecording.id;
    if (mixRecording) return mixRecording.id;
    if (farRecording) return farRecording.id;
    if (nearRecording) return nearRecording.id;
    return null;
  }, [stereoRecording, mixRecording, farRecording, nearRecording]);

  const togglePlay = useCallback(() => {
    if (playing) setPauseSignal((n) => (n ?? 0) + 1);
    else setPlaySignal((n) => (n ?? 0) + 1);
  }, [playing]);

  const onSeek = useCallback(
    (value: number) => {
      if (!duration) return;
      setSeekTo((value / 100) * duration);
    },
    [duration],
  );

  const saveTag = async () => {
    if (!regionModal || tagRecordingId == null) return;
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

  const downloadAudio = async () => {
    if (!downloadRecording) return;
    setDownloading(true);
    try {
      await api.downloadRecording(downloadRecording.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const c = call.data;
  const nearParty = formatParty(c?.near_name, c?.near_addr);
  const farParty = formatParty(c?.far_name, c?.far_addr);
  const status = c?.status;
  const tagList = tags.data ?? [];
  const selectedTag = tagList.find((t) => t.id === selectedTagId) ?? null;
  const transcriptList = transcripts.data ?? [];
  const listBack = trashOnly ? '/recordings?trashed=true' : '/recordings';

  if (!Number.isFinite(callId)) {
    return (
      <Text c="dimmed" size="sm">
        Invalid recording id.
      </Text>
    );
  }

  return (
    <Stack gap="md" className={classes.detailPage}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Box>
          <Breadcrumbs mb="xs">
            <Anchor component={Link} to={listBack} size="sm">
              Recordings
            </Anchor>
            <Text size="sm" c="dimmed">
              Details
            </Text>
          </Breadcrumbs>
          <Title order={2}>{c ? callTitle(c) : 'Recording'}</Title>
          {c && (
            <Text size="sm" c="dimmed" mt={4}>
              Near: {nearParty} · Far: {farParty}
              {c.started_at ? ` · ${new Date(c.started_at).toLocaleString()}` : ''}
            </Text>
          )}
          {c && (
            <Group gap="xs" mt="sm">
              {status && <CallStatusBadge status={status} />}
              {c.sentiment && (
                <Badge size="sm" variant="light" radius="sm" color={SENTIMENT_COLORS[c.sentiment] ?? 'gray'}>
                  {c.sentiment}
                </Badge>
              )}
              {c.source && <SourceBadge source={c.source} />}
              {c.legal_hold && (
                <Badge color="orange" variant="light" radius="sm" leftSection={<IconLock size={11} />}>
                  Legal hold
                </Badge>
              )}
              {c.holding && (
                <Badge color="gray" variant="light" radius="sm">
                  Unconfigured
                </Badge>
              )}
              {c.trashed_at && (
                <Badge color="gray" variant="light" radius="sm" leftSection={<IconTrash size={11} />}>
                  Trash
                </Badge>
              )}
            </Group>
          )}
        </Box>
        <Group gap="xs">
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconArrowLeft size={14} />}
            onClick={() => navigate(listBack)}
          >
            Back
          </Button>
          {hasAudio && (
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDownload size={14} />}
              loading={downloading}
              onClick={() => void downloadAudio()}
            >
              Download
            </Button>
          )}
          <Button
            size="xs"
            variant="light"
            leftSection={c?.is_unread ? <IconMailOpened size={14} /> : <IconMail size={14} />}
            loading={markUnread.isPending}
            disabled={!c || !!c.is_unread}
            onClick={() => markUnread.mutate()}
          >
            Mark unread
          </Button>
          {canManageRetention && c && !c.trashed_at && (
            <Tooltip label="Release legal hold before trashing" disabled={!c.legal_hold}>
              <span>
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  disabled={!!c.legal_hold}
                  onClick={() => setTrashConfirmOpen(true)}
                >
                  Trash
                </Button>
              </span>
            </Tooltip>
          )}
          {canManageRetention && c?.trashed_at && (
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRestore size={14} />}
              loading={restoreCall.isPending}
              onClick={() => restoreCall.mutate()}
            >
              Restore
            </Button>
          )}
        </Group>
      </Group>

      {c?.trashed_at && (
        <Alert variant="light" color="orange" icon={<IconInfoCircle size={16} />}>
          In trash — recoverable for about {daysUntilTrashPurge(c.trashed_at)} more day
          {daysUntilTrashPurge(c.trashed_at) === 1 ? '' : 's'}, then permanently deleted.
        </Alert>
      )}

      {c && (
        <div className={classes.metaStrip}>
          <div className={classes.metaItem}>
            <Text className={classes.metaLabel}>Status</Text>
            {status ? <CallStatusBadge status={status} /> : <Text size="sm">—</Text>}
          </div>
          <div className={classes.metaItem}>
            <Text className={classes.metaLabel}>Source</Text>
            {c.source ? <SourceBadge source={c.source} /> : <Text size="sm">—</Text>}
          </div>
          <div className={classes.metaItem}>
            <Text className={classes.metaLabel}>Duration</Text>
            <Text size="sm">{c.duration_s != null ? formatTime(c.duration_s) : '—'}</Text>
          </div>
          <div className={classes.metaItem}>
            <Text className={classes.metaLabel}>Legal hold</Text>
            {canManageRetention ? (
              <Switch
                size="sm"
                checked={!!c.legal_hold}
                disabled={legalHold.isPending}
                onChange={(e) => legalHold.mutate(e.currentTarget.checked)}
              />
            ) : (
              <Text size="sm">{c.legal_hold ? 'Yes' : 'No'}</Text>
            )}
          </div>
          {c.group_name && (
            <div className={classes.metaItem}>
              <Text className={classes.metaLabel}>Group</Text>
              <Text size="sm">{c.group_name}</Text>
            </div>
          )}
          <div className={classes.metaItem}>
            <Text className={classes.metaLabel}>Read</Text>
            <Text size="sm">{c.is_unread ? 'Unread' : 'Read'}</Text>
          </div>
        </div>
      )}

      <Card padding="md" radius="md" className={classes.waveformCard}>
        {hasAudio ? (
          <Stack gap="sm">
            <DualChannelWaveform
              nearRecording={nearRecording}
              farRecording={farRecording}
              stereoRecording={stereoRecording}
              mixRecording={mixRecording}
              audioUrl={api.audioUrl}
              nearLabel={nearParty}
              farLabel={farParty}
              highlightTag={
                selectedTag ? { start: selectedTag.start_s, end: selectedTag.end_s, note: selectedTag.note } : null
              }
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
              <ActionIcon variant="filled" size="xl" radius="xl" onClick={togglePlay} aria-label="Play or pause">
                {playing ? <IconPlayerPause size={22} /> : <IconPlayerPlay size={22} />}
              </ActionIcon>
              <Text size="xs" c="dimmed" ff="monospace" style={{ width: 44 }}>
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
              <Text size="xs" c="dimmed" ff="monospace" style={{ width: 44, textAlign: 'right' }}>
                {formatTime(duration)}
              </Text>
              {canManageTags && (
                <Button size="xs" variant="light" leftSection={<IconTag size={14} />} onClick={() => setTagSelectSignal((n) => n + 1)}>
                  Tag region
                </Button>
              )}
            </Group>
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

      <Card padding="md" radius="md" className={classes.contentCard}>
        <Text fw={600} mb="xs">
          Summary
        </Text>
        {c?.summary ? (
          <Text size="sm">{c.summary}</Text>
        ) : (
          <Text size="sm" c="dimmed">
            Summary available after transcription.
          </Text>
        )}
      </Card>

      <Card padding="md" radius="md" className={classes.contentCard}>
        <Text fw={600} mb="xs">
          Notes
        </Text>
        <Textarea
          value={notesDraft}
          onChange={(e) => {
            setNotesDraft(e.currentTarget.value);
            setNotesDirty(true);
          }}
          placeholder="Add notes about this call…"
          autosize
          minRows={3}
          mb="sm"
        />
        <Button
          size="xs"
          variant="light"
          loading={saveNotes.isPending}
          disabled={!notesDirty}
          onClick={() => saveNotes.mutate()}
        >
          Save notes
        </Button>
        {saveNotes.isError && (
          <Text size="xs" c="red" mt="xs">
            {(saveNotes.error as Error).message}
          </Text>
        )}
      </Card>

      <Card padding="md" radius="md" className={classes.contentCard}>
        <Text fw={600} mb="xs">
          Tags
        </Text>
        {tagList.length === 0 ? (
          <Text size="sm" c="dimmed">
            {canManageTags ? 'Select a region on the waveform to add a tag.' : 'No tags.'}
          </Text>
        ) : (
          <Group gap={6}>
            {tagList.map((t) => (
              <Badge
                key={t.id}
                radius="sm"
                variant={selectedTagId === t.id ? 'filled' : 'light'}
                className={classes.tagBadge}
                onClick={() => {
                  setSelectedTagId((cur) => (cur === t.id ? null : t.id));
                  setSeekTo(t.start_s + Math.random() * 1e-6);
                }}
                title={t.note || undefined}
              >
                {formatTime(t.start_s)}–{formatTime(t.end_s)}
                {t.note ? `: ${t.note}` : ''}
              </Badge>
            ))}
          </Group>
        )}
      </Card>

      {canViewTranscripts && (
        <Card padding="md" radius="md" className={classes.contentCard}>
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
            nearLabel="Near"
            farLabel="Far"
            currentTime={currentTime}
            onSeek={(t) => setSeekTo(t + Math.random() * 1e-6)}
            maxHeight={420}
          />
        </Card>
      )}

      <Modal opened={!!regionModal} onClose={() => setRegionModal(null)} title="Tag region">
        {regionModal && (
          <Text size="sm" c="dimmed" mb="sm">
            {formatTime(regionModal.start)} – {formatTime(regionModal.end)}
          </Text>
        )}
        <Textarea label="Note" value={tagNote} onChange={(e) => setTagNote(e.currentTarget.value)} mb="md" autosize minRows={2} />
        <Button onClick={saveTag}>Save tag</Button>
      </Modal>

      <Modal opened={trashConfirmOpen} onClose={() => setTrashConfirmOpen(false)} title="Move to trash?">
        <Text size="sm" mb="md">
          This recording will leave the active list and can be recovered for {TRASH_RETENTION_DAYS}{' '}
          days. After that it is permanently deleted (audio, tags, and transcripts).
        </Text>
        {trashCall.isError && (
          <Text size="sm" c="red" mb="sm">
            {(trashCall.error as Error).message}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setTrashConfirmOpen(false)}>
            Cancel
          </Button>
          <Button color="red" loading={trashCall.isPending} onClick={() => trashCall.mutate()}>
            Move to trash
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
