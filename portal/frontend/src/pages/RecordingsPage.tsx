import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  Modal,
  Pagination,
  ScrollArea,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAdjustments,
  IconArrowLeft,
  IconLock,
  IconPlayerPause,
  IconPlayerPlay,
  IconTag,
} from '@tabler/icons-react';
import { api, hasPermission, recordingHasMedia } from '../api/client';
import { CallStatusBadge } from '../components/CallStatusBadge';
import { SourceBadge } from '../components/SourceBadge';
import { useAuth } from '../auth/AuthContext';
import { DualChannelWaveform } from '../components/DualChannelWaveform';
import { ConversationTranscript } from '../components/ConversationTranscript';
import classes from './RecordingsPage.module.css';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
};

const PAGE_SIZE = 50;

function CallList({ selectedId }: { selectedId: number | null }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [direction, setDirection] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, direction, source, sentiment]);

  const params: Record<string, string> = { page: String(page), page_size: String(PAGE_SIZE) };
  if (q) params.q = q;
  if (direction) params.direction = direction;
  if (source) params.source = source;
  if (sentiment) params.sentiment = sentiment;

  const { data, isLoading } = useQuery({
    queryKey: ['calls', params],
    queryFn: () => api.listCalls(params),
    refetchInterval: 30000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={classes.listPane}>
      <Box p="sm">
        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="sm"
            placeholder="Search calls…"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Tooltip label="Filters">
            <ActionIcon
              variant={showFilters ? 'filled' : 'light'}
              size="lg"
              onClick={() => setShowFilters((v) => !v)}
              aria-label="Toggle filters"
            >
              <IconAdjustments size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Collapse in={showFilters}>
          <Stack gap="xs" mt="xs">
            <Select
              size="xs"
              placeholder="Source"
              aria-label="Filter by source"
              clearable
              data={['cucm', 'webex']}
              value={source}
              onChange={setSource}
            />
            <Select
              size="xs"
              placeholder="Direction"
              aria-label="Filter by direction"
              clearable
              data={['inbound', 'outbound', 'internal']}
              value={direction}
              onChange={setDirection}
            />
            <Select
              size="xs"
              placeholder="Sentiment"
              aria-label="Filter by sentiment"
              clearable
              data={['positive', 'neutral', 'negative']}
              value={sentiment}
              onChange={setSentiment}
            />
          </Stack>
        </Collapse>
      </Box>
      <div className={classes.listScroll}>
        {isLoading ? (
          <Box p="md">
            <Loader size="sm" />
          </Box>
        ) : items.length === 0 ? (
          <Text p="md" c="dimmed" size="sm">
            No calls match.
          </Text>
        ) : (
          <ul className={classes.list}>
            {items.map((c) => {
              const title = c.far_name || c.far_addr || 'Unknown';
              const active = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={active ? `${classes.row} ${classes.rowActive}` : classes.row}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => navigate(`/recordings/${c.id}`)}
                  >
                    <div className={classes.playGlyph} aria-hidden="true">
                      <IconPlayerPlay size={15} />
                    </div>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>
                        {title}
                      </Text>
                      <div className={classes.rowMeta}>
                        {(c.source || '').toUpperCase()} · {shortDate(c.started_at)} ·{' '}
                        {c.duration_s != null ? formatTime(c.duration_s) : '—'}
                      </div>
                    </Box>
                    <SourceBadge source={c.source} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className={classes.listFooter}>
        <Text size="xs" c="dimmed">
          {total.toLocaleString()} call{total === 1 ? '' : 's'}
        </Text>
        {totalPages > 1 && (
          <Pagination size="xs" total={totalPages} value={page} onChange={setPage} siblings={1} boundaries={1} />
        )}
      </div>
    </div>
  );
}

function CallDetail({ callId }: { callId: number }) {
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
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);

  const canManageTags = hasPermission(user, 'manage_tags');
  const canViewTranscripts = hasPermission(user, 'view_transcripts');
  const canManageRetention = hasPermission(user, 'manage_retention');

  const call = useQuery({
    queryKey: ['call', callId],
    queryFn: () => api.getCall(callId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'recording' || s === 'processing' || s === 'transcribing' ? 3000 : false;
    },
  });

  const recordings = useQuery({
    queryKey: ['recordings', callId],
    queryFn: () => api.getRecordings(callId),
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      const pending = items.length === 0 || items.some((r) => !recordingHasMedia(r));
      return pending ? 3000 : false;
    },
  });

  const tags = useQuery({ queryKey: ['tags', callId], queryFn: () => api.listTags(callId) });

  const transcripts = useQuery({
    queryKey: ['transcripts', callId],
    queryFn: () => api.listTranscripts(callId),
    enabled: canViewTranscripts,
    refetchInterval: call.data?.status === 'transcribing' ? 3000 : false,
  });

  const legalHold = useMutation({
    mutationFn: (value: boolean) => api.setLegalHold(callId, value),
    onSuccess: () => call.refetch(),
  });

  const items = recordings.data ?? [];
  const nearRecording = items.find((r) => r.leg === 'near' && recordingHasMedia(r)) ?? null;
  const farRecording = items.find((r) => r.leg === 'far' && recordingHasMedia(r)) ?? null;
  const stereoRecording = items.find((r) => r.leg === 'stereo' && recordingHasMedia(r)) ?? null;
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

  const tagList = tags.data ?? [];
  const selectedTag = tagList.find((t) => t.id === selectedTagId) ?? null;
  const transcriptList = transcripts.data ?? [];
  const c = call.data;
  const nearLabel = c?.near_name || c?.near_addr || 'near';
  const farLabel = c?.far_name || c?.far_addr || 'far';
  const status = c?.status;

  return (
    <>
      <Stack gap="md">
        <Card padding="md" radius="md">
          <Group justify="space-between" align="flex-start" wrap="wrap" mb="sm">
            <Box>
              <Group gap="xs" wrap="wrap">
                <Title order={3}>{farLabel}</Title>
                {c?.source && <SourceBadge source={c.source} />}
                {status && <CallStatusBadge status={status} />}
                {c?.legal_hold && (
                  <Badge color="orange" variant="light" leftSection={<IconLock size={11} />}>
                    Legal hold
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                Near: {nearLabel} · Far: {farLabel}
                {c?.duration_s != null ? ` · ${formatTime(c.duration_s)}` : ''}
                {c?.started_at ? ` · ${new Date(c.started_at).toLocaleString()}` : ''}
              </Text>
            </Box>
          </Group>

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

        {canViewTranscripts && (
          <Card padding="md" radius="md">
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
              maxHeight={420}
            />
          </Card>
        )}
      </Stack>

      <div className={classes.rail}>
        <Stack gap="md">
          <Card padding="md" radius="md">
            <Text fw={600} size="sm" mb="xs">
              Details
            </Text>
            <Stack gap={6}>
              <DetailRow label="Source" value={c?.source ? <SourceBadge source={c.source} /> : '—'} />
              <DetailRow label="Ref CI" value={<Text ff="monospace" size="xs">{c?.refci || '—'}</Text>} />
              <DetailRow label="Direction" value={c?.direction || '—'} />
              <DetailRow
                label="Started"
                value={<Text size="xs">{c?.started_at ? new Date(c.started_at).toLocaleString() : '—'}</Text>}
              />
              <DetailRow label="Duration" value={c?.duration_s != null ? formatTime(c.duration_s) : '—'} />
              {c?.sentiment && (
                <DetailRow
                  label="Sentiment"
                  value={
                    <Badge size="sm" variant="light" color={SENTIMENT_COLORS[c.sentiment] ?? 'gray'}>
                      {c.sentiment}
                    </Badge>
                  }
                />
              )}
            </Stack>
          </Card>

          {canManageRetention && (
            <Card padding="md" radius="md">
              <Group justify="space-between">
                <Box>
                  <Text fw={600} size="sm">
                    Legal hold
                  </Text>
                  <Text size="xs" c="dimmed">
                    Exempt from retention purge
                  </Text>
                </Box>
                <Switch
                  checked={!!c?.legal_hold}
                  disabled={legalHold.isPending || !c}
                  onChange={(e) => legalHold.mutate(e.currentTarget.checked)}
                />
              </Group>
            </Card>
          )}

          <Card padding="md" radius="md">
            <Text fw={600} size="sm" mb="xs">
              Tags
            </Text>
            {tagList.length === 0 ? (
              <Text size="xs" c="dimmed">
                {canManageTags ? 'Select a region on the waveform to add a tag.' : 'No tags.'}
              </Text>
            ) : (
              <ScrollArea.Autosize mah={220}>
                <Stack gap={6}>
                  {tagList.map((t) => (
                    <Badge
                      key={t.id}
                      variant={selectedTagId === t.id ? 'filled' : 'light'}
                      style={{ cursor: 'pointer' }}
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
                </Stack>
              </ScrollArea.Autosize>
            )}
          </Card>
        </Stack>
      </div>

      <Modal opened={!!regionModal} onClose={() => setRegionModal(null)} title="Tag region">
        {regionModal && (
          <Text size="sm" c="dimmed" mb="sm">
            {formatTime(regionModal.start)} – {formatTime(regionModal.end)}
          </Text>
        )}
        <Textarea label="Note" value={tagNote} onChange={(e) => setTagNote(e.currentTarget.value)} mb="md" autosize minRows={2} />
        <Button onClick={saveTag}>Save tag</Button>
      </Modal>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <div style={{ textAlign: 'right' }}>{typeof value === 'string' ? <Text size="sm">{value}</Text> : value}</div>
    </Group>
  );
}

export function RecordingsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const callId = id ? Number(id) : null;
  const stats = useQuery({ queryKey: ['dashboard-stats'], queryFn: api.dashboardStats });
  // Below this width the list and detail panes take turns instead of sharing
  // the row — a shrunk three-pane layout reads as cramped, not responsive.
  const isNarrow = !!useMediaQuery('(max-width: 860px)');
  const showList = !isNarrow || callId == null;
  const showDetail = !isNarrow || callId != null;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Recordings</Title>
        {isNarrow && callId != null && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconArrowLeft size={14} />}
            onClick={() => navigate('/recordings')}
          >
            Back to list
          </Button>
        )}
      </Group>
      <div className={classes.layout}>
        {showList && <CallList selectedId={callId} />}
        {showDetail &&
          (callId != null ? (
            <CallDetail key={callId} callId={callId} />
          ) : (
            <Card padding="md" radius="md">
              <div className={classes.empty}>
                <Text fw={600}>Select a call to play its recording</Text>
                <Text size="sm" c="dimmed" mt={4}>
                  {stats.data
                    ? `${stats.data.calls_total.toLocaleString()} call${stats.data.calls_total === 1 ? '' : 's'} in this tenant.`
                    : ' '}{' '}
                  Use the search box or filters on the left, or click any row.
                </Text>
              </div>
            </Card>
          ))}
      </div>
    </Stack>
  );
}
