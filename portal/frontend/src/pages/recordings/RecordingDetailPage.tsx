import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Group,
  Modal,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconDownload,
  IconFileText,
  IconInfoCircle,
  IconMail,
  IconMailOpened,
  IconMessages,
  IconNote,
  IconPlayerPause,
  IconPlayerPlay,
  IconRestore,
  IconTag,
  IconTrash,
} from '@tabler/icons-react';
import { api, hasPermission, recordingHasMedia } from '../../api/client';
import { CallStatusBadge } from '../../components/CallStatusBadge';
import { useAuth } from '../../auth/AuthContext';
import { DualChannelWaveform } from '../../components/DualChannelWaveform';
import { ConversationTranscript } from '../../components/ConversationTranscript';
import {
  SENTIMENT_COLORS,
  TRASH_RETENTION_DAYS,
  callTitle,
  daysUntilTrashPurge,
  formatCallSource,
  formatDurationHms,
  formatTime,
  longDateTime,
  partyParts,
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
  const near = partyParts(c?.near_name, c?.near_addr);
  const far = partyParts(c?.far_name, c?.far_addr);
  const nearLabel = near.detail ? `${near.name} (${near.detail})` : near.name;
  const farLabel = far.detail ? `${far.name} (${far.detail})` : far.name;
  const status = c?.status;
  const tagList = tags.data ?? [];
  const selectedTag = tagList.find((t) => t.id === selectedTagId) ?? null;
  const transcriptList = transcripts.data ?? [];
  const listBack = trashOnly ? '/recordings?trashed=true' : '/recordings';
  const durationSeconds = duration || c?.duration_s || 0;

  if (!Number.isFinite(callId)) {
    return (
      <Text c="dimmed" size="sm">
        Invalid recording id.
      </Text>
    );
  }

  return (
    <Stack gap="md" className={classes.detailPage}>
      <Breadcrumbs>
        <Anchor component={Link} to={listBack} size="sm">
          Recordings
        </Anchor>
        <Text size="sm" c="dimmed">
          Details
        </Text>
      </Breadcrumbs>

      <div className={classes.detailHeader}>
        <div className={classes.headerTop}>
          <div className={classes.headerTitleBlock}>
            <Title order={2} style={{ lineHeight: 1.25 }}>
              {c ? callTitle(c) : 'Recording'}
            </Title>
            {c && (
              <div className={classes.headerMetaLine}>
                {c.started_at ? longDateTime(c.started_at) : '—'}
                <span aria-hidden="true"> · </span>
                ID: {c.id}
              </div>
            )}
          </div>
          <div className={classes.headerActions}>
            {status && <CallStatusBadge status={status} radius="sm" />}
            {c?.sentiment && (
              <Badge size="sm" variant="light" radius="sm" color={SENTIMENT_COLORS[c.sentiment] ?? 'gray'}>
                {c.sentiment}
              </Badge>
            )}
            <Tooltip label="Back to list">
              <ActionIcon variant="subtle" color="gray" onClick={() => navigate(listBack)} aria-label="Back">
                <IconArrowLeft size={18} />
              </ActionIcon>
            </Tooltip>
            {hasAudio && (
              <Tooltip label="Download">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  loading={downloading}
                  onClick={() => void downloadAudio()}
                  aria-label="Download"
                >
                  <IconDownload size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={c?.is_unread ? 'Already unread' : 'Mark unread'}>
              <ActionIcon
                variant="subtle"
                color="gray"
                loading={markUnread.isPending}
                disabled={!c || !!c.is_unread}
                onClick={() => markUnread.mutate()}
                aria-label="Mark unread"
              >
                {c?.is_unread ? <IconMailOpened size={18} /> : <IconMail size={18} />}
              </ActionIcon>
            </Tooltip>
            {canManageRetention && c && !c.trashed_at && (
              <Tooltip label={c.legal_hold ? 'Release legal hold before trashing' : 'Move to trash'}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  disabled={!!c.legal_hold}
                  onClick={() => setTrashConfirmOpen(true)}
                  aria-label="Trash"
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {canManageRetention && c?.trashed_at && (
              <Tooltip label="Restore">
                <ActionIcon
                  variant="subtle"
                  color="brandBlue"
                  loading={restoreCall.isPending}
                  onClick={() => restoreCall.mutate()}
                  aria-label="Restore"
                >
                  <IconRestore size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {c?.trashed_at && (
        <Alert variant="light" color="orange" icon={<IconInfoCircle size={16} />}>
          In trash — recoverable for about {daysUntilTrashPurge(c.trashed_at)} more day
          {daysUntilTrashPurge(c.trashed_at) === 1 ? '' : 's'}, then permanently deleted.
        </Alert>
      )}

      <div className={classes.detailColumns}>
        <div className={classes.detailMain}>
          <Card padding="md" radius="md" className={classes.waveformCard}>
            {hasAudio ? (
              <Stack gap="sm">
                <div className={classes.waveLegend}>
                  <span className={classes.waveLegendItem}>
                    <span className={`${classes.waveSwatch} ${classes.waveSwatchNear}`} />
                    Near ({near.name})
                  </span>
                  <span className={classes.waveLegendItem}>
                    <span className={`${classes.waveSwatch} ${classes.waveSwatchFar}`} />
                    Far ({far.name})
                  </span>
                </div>
                <DualChannelWaveform
                  nearRecording={nearRecording}
                  farRecording={farRecording}
                  stereoRecording={stereoRecording}
                  mixRecording={mixRecording}
                  audioUrl={api.audioUrl}
                  nearLabel={nearLabel}
                  farLabel={farLabel}
                  highlightTag={
                    selectedTag
                      ? { start: selectedTag.start_s, end: selectedTag.end_s, note: selectedTag.note }
                      : null
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
                <div className={classes.transport}>
                  <ActionIcon variant="filled" size="xl" radius="xl" onClick={togglePlay} aria-label="Play or pause">
                    {playing ? <IconPlayerPause size={22} /> : <IconPlayerPlay size={22} />}
                  </ActionIcon>
                  <Text size="xs" c="dimmed" ff="monospace" style={{ width: 52 }}>
                    {formatDurationHms(currentTime)}
                  </Text>
                  <Slider
                    style={{ flex: 1 }}
                    value={durationSeconds ? (currentTime / durationSeconds) * 100 : 0}
                    onChange={onSeek}
                    disabled={!durationSeconds}
                    size="sm"
                    label={(v) => (durationSeconds ? formatDurationHms((v / 100) * durationSeconds) : null)}
                    color="brandBlue"
                  />
                  <Text size="xs" c="dimmed" ff="monospace" style={{ width: 52, textAlign: 'right' }}>
                    {formatDurationHms(durationSeconds)}
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
                </div>
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

          <Tabs defaultValue="summary" className={classes.detailTabs}>
            <Tabs.List>
              <Tabs.Tab value="summary" leftSection={<IconFileText size={14} />}>
                Summary
              </Tabs.Tab>
              <Tabs.Tab value="notes" leftSection={<IconNote size={14} />}>
                Notes
              </Tabs.Tab>
              <Tabs.Tab value="tags" leftSection={<IconTag size={14} />}>
                Tags
              </Tabs.Tab>
              {canViewTranscripts && (
                <Tabs.Tab value="transcription" leftSection={<IconMessages size={14} />}>
                  Transcription
                </Tabs.Tab>
              )}
            </Tabs.List>

            <Tabs.Panel value="summary" className={classes.detailTabPanel}>
              {c?.summary ? (
                <Text size="sm" style={{ lineHeight: 1.55 }}>
                  {c.summary}
                </Text>
              ) : (
                <Text size="sm" c="dimmed">
                  Summary available after transcription.
                </Text>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="notes" className={classes.detailTabPanel}>
              <Textarea
                value={notesDraft}
                onChange={(e) => {
                  setNotesDraft(e.currentTarget.value);
                  setNotesDirty(true);
                }}
                placeholder="Add notes about this call…"
                autosize
                minRows={4}
                mb="sm"
                styles={{ input: { borderColor: '#e9eaed' } }}
              />
              <Group justify="flex-end">
                <Button
                  size="xs"
                  variant="light"
                  loading={saveNotes.isPending}
                  disabled={!notesDirty}
                  onClick={() => saveNotes.mutate()}
                >
                  Save notes
                </Button>
              </Group>
              {saveNotes.isError && (
                <Text size="xs" c="red" mt="xs">
                  {(saveNotes.error as Error).message}
                </Text>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="tags" className={classes.detailTabPanel}>
              {tagList.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {canManageTags ? 'Select a region on the waveform to add a tag.' : 'No tags.'}
                </Text>
              ) : (
                <Group gap={8}>
                  {tagList.map((t) => (
                    <Badge
                      key={t.id}
                      radius="sm"
                      variant={selectedTagId === t.id ? 'filled' : 'outline'}
                      color="brandBlue"
                      className={classes.tagChip}
                      onClick={() => {
                        setSelectedTagId((cur) => (cur === t.id ? null : t.id));
                        setSeekTo(t.start_s + Math.random() * 1e-6);
                      }}
                      title={t.note || undefined}
                    >
                      {formatTime(t.start_s)}–{formatTime(t.end_s)}
                      {t.note ? ` · ${t.note}` : ''}
                    </Badge>
                  ))}
                </Group>
              )}
            </Tabs.Panel>

            {canViewTranscripts && (
              <Tabs.Panel value="transcription" className={classes.detailTabPanel}>
                {transcripts.isLoading && (
                  <Text size="sm" c="dimmed">
                    Loading…
                  </Text>
                )}
                {status === 'transcribing' && (
                  <Text size="sm" c="dimmed">
                    Transcription in progress…
                  </Text>
                )}
                {!transcripts.isLoading && transcriptList.length === 0 && status === 'completed' && (
                  <Text size="sm" c="dimmed">
                    No transcript available for this call.
                  </Text>
                )}
                <ConversationTranscript
                  transcripts={transcriptList}
                  nearLabel={nearLabel}
                  farLabel={farLabel}
                  currentTime={currentTime}
                  onSeek={(t) => setSeekTo(t + Math.random() * 1e-6)}
                  maxHeight={480}
                  layout="timeline"
                />
              </Tabs.Panel>
            )}
          </Tabs>
        </div>

        {c && (
          <aside className={classes.detailAside}>
            <div className={classes.asideCard}>
              <div className={classes.asideCardHeader}>Call details</div>
              <div className={classes.asideCardBody}>
                <div className={classes.asideRow}>
                  <Text className={classes.asideLabel}>Date & time</Text>
                  <Text className={classes.asideValue}>
                    {c.started_at ? longDateTime(c.started_at) : '—'}
                  </Text>
                </div>
                <div className={classes.asideRow}>
                  <Text className={classes.asideLabel}>Duration</Text>
                  <Text className={classes.asideValue}>
                    {c.duration_s != null ? formatDurationHms(c.duration_s) : '—'}
                  </Text>
                </div>
                <div className={classes.asideRow}>
                  <Text className={classes.asideLabel}>Source</Text>
                  <Text className={classes.asideValue}>{formatCallSource(c.source)}</Text>
                </div>
                <div className={classes.asideRow}>
                  <Text className={classes.asideLabel}>Status</Text>
                  <div className={classes.asideValue}>
                    {status ? <CallStatusBadge status={status} radius="sm" /> : '—'}
                  </div>
                </div>
                {c.sentiment && (
                  <div className={classes.asideRow}>
                    <Text className={classes.asideLabel}>Sentiment</Text>
                    <div className={classes.asideValue}>
                      <Badge size="sm" variant="light" radius="sm" color={SENTIMENT_COLORS[c.sentiment] ?? 'gray'}>
                        {c.sentiment}
                      </Badge>
                    </div>
                  </div>
                )}
                <div className={classes.asideRow}>
                  <Text className={classes.asideLabel}>Legal hold</Text>
                  <div className={classes.asideValue}>
                    {canManageRetention ? (
                      <Switch
                        size="sm"
                        checked={!!c.legal_hold}
                        disabled={legalHold.isPending}
                        onChange={(e) => legalHold.mutate(e.currentTarget.checked)}
                        aria-label="Legal hold"
                      />
                    ) : (
                      <Text component="span" size="sm">
                        {c.legal_hold ? 'On' : 'Off'}
                      </Text>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className={classes.asideCard}>
              <div className={classes.asideCardHeader}>Parties</div>
              <div className={classes.asideCardBody}>
                <div className={classes.partyCard}>
                  <span className={`${classes.partyLabel} ${classes.partyLabelNear}`}>Near</span>
                  <span className={classes.partyName}>{near.name}</span>
                  {near.detail && <span className={classes.partyDetail}>{near.detail}</span>}
                </div>
                <div className={classes.partyCard}>
                  <span className={`${classes.partyLabel} ${classes.partyLabelFar}`}>Far</span>
                  <span className={classes.partyName}>{far.name}</span>
                  {far.detail && <span className={classes.partyDetail}>{far.detail}</span>}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

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
