import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Alert,
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
  IconInfoCircle,
  IconLock,
  IconPlayerPause,
  IconPlayerPlay,
  IconRestore,
  IconTag,
  IconTrash,
} from '@tabler/icons-react';
import { api, hasPermission, recordingHasMedia } from '../api/client';
import { CallStatusBadge } from '../components/CallStatusBadge';
import { SourceBadge } from '../components/SourceBadge';
import { useAuth } from '../auth/AuthContext';
import { DualChannelWaveform } from '../components/DualChannelWaveform';
import { ConversationTranscript } from '../components/ConversationTranscript';
import { formatParty } from '../utils/partyLabel';
import classes from './RecordingsPage.module.css';

const TRASH_RETENTION_DAYS = 30;

function daysUntilTrashPurge(trashedAt: string): number {
  const purgeAt = new Date(trashedAt).getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

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

function CallList({
  selectedId,
  holdingOnly,
  trashOnly,
}: {
  selectedId: number | null;
  holdingOnly: boolean;
  trashOnly: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canFilterByGroup =
    hasPermission(user, 'view_all_calls') || hasPermission(user, 'view_group_calls');
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(holdingOnly || trashOnly);
  const [direction, setDirection] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [holding, setHolding] = useState(holdingOnly);
  const [trashed, setTrashed] = useState(trashOnly);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setHolding(holdingOnly);
    if (holdingOnly) setShowFilters(true);
  }, [holdingOnly]);

  useEffect(() => {
    setTrashed(trashOnly);
    if (trashOnly) setShowFilters(true);
  }, [trashOnly]);

  useEffect(() => {
    setPage(1);
  }, [q, direction, source, sentiment, groupFilter, holding, trashed]);

  const { data: myGroups } = useQuery({
    queryKey: ['groups-mine'],
    queryFn: api.groupsMine,
    staleTime: 60_000,
    enabled: canFilterByGroup,
  });

  const params: Record<string, string> = { page: String(page), page_size: String(PAGE_SIZE) };
  if (q) params.q = q;
  if (direction) params.direction = direction;
  if (source) params.source = source;
  if (sentiment) params.sentiment = sentiment;
  if (groupFilter) params.group_id = groupFilter;
  if (holding) params.holding = 'true';
  if (trashed) params.trashed = 'true';

  const { data, isLoading } = useQuery({
    queryKey: ['calls', params],
    queryFn: () => api.listCalls(params),
    refetchInterval: 30000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const groupSections = useMemo(() => {
    if (!canFilterByGroup || groupFilter || items.length === 0) return null;
    const byGroup = new Map<string, typeof items>();
    for (const call of items) {
      const key = call.group_name ?? 'Ungrouped';
      const bucket = byGroup.get(key) ?? [];
      bucket.push(call);
      byGroup.set(key, bucket);
    }
    if (byGroup.size <= 1) return null;
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [canFilterByGroup, groupFilter, items]);

  const renderCallRow = (c: (typeof items)[number]) => {
    const title = formatParty(c.far_name, c.far_addr);
    const active = c.id === selectedId;
    return (
      <li key={c.id}>
        <button
          type="button"
          className={active ? `${classes.row} ${classes.rowActive}` : classes.row}
          aria-current={active ? 'true' : undefined}
          onClick={() =>
            navigate(trashed ? `/recordings/${c.id}?trashed=true` : `/recordings/${c.id}`)
          }
        >
          <div className={classes.playGlyph} aria-hidden="true">
            <IconPlayerPlay size={15} />
          </div>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={c.is_unread ? 600 : 400} truncate>
              {title}
            </Text>
            <div className={`${classes.rowMeta}${c.is_unread ? '' : ` ${classes.rowMetaRead}`}`}>
              {(c.source || '').toUpperCase()} · {shortDate(c.started_at)} ·{' '}
              {c.duration_s != null ? formatTime(c.duration_s) : '—'}
              {c.trashed_at ? ` · ${daysUntilTrashPurge(c.trashed_at)}d left` : ''}
            </div>
          </Box>
          <Group gap={4}>
            {c.holding && (
              <Badge size="xs" variant="light" color="orange">
                Unconfigured
              </Badge>
            )}
            {c.trashed_at && (
              <Badge size="xs" variant="light" color="gray">
                Trash
              </Badge>
            )}
            <SourceBadge source={c.source} />
          </Group>
        </button>
      </li>
    );
  };

  return (
    <div className={classes.listPane}>
      <Box p="sm">
        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="sm"
            placeholder={trashed ? 'Search trash…' : 'Search calls…'}
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
            {canFilterByGroup && (
              <Select
                size="xs"
                placeholder="Group"
                aria-label="Filter by group"
                clearable
                data={(myGroups ?? []).map((g) => ({ value: String(g.id), label: g.name }))}
                value={groupFilter}
                onChange={setGroupFilter}
              />
            )}
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
            <Switch
              size="xs"
              label="Unconfigured only"
              checked={holding}
              onChange={(e) => setHolding(e.currentTarget.checked)}
            />
            <Switch
              size="xs"
              label="Trash"
              checked={trashed}
              onChange={(e) => {
                const next = e.currentTarget.checked;
                setTrashed(next);
                navigate(next ? '/recordings?trashed=true' : '/recordings');
              }}
            />
          </Stack>
        </Collapse>
        {trashed && (
          <Alert variant="light" color="gray" icon={<IconInfoCircle size={14} />} mt="xs" p="xs">
            <Text size="xs">
              Trashed recordings can be recovered for {TRASH_RETENTION_DAYS} days, then are permanently
              deleted.
            </Text>
          </Alert>
        )}
      </Box>
      <div className={classes.listScroll}>
        {isLoading ? (
          <Box p="md">
            <Loader size="sm" />
          </Box>
        ) : items.length === 0 ? (
          <Text p="md" c="dimmed" size="sm">
            {trashed ? 'Trash is empty.' : 'No calls match.'}
          </Text>
        ) : groupSections ? (
          <div>
            {groupSections.map(([groupName, calls]) => (
              <section key={groupName}>
                <Text size="xs" fw={600} c="dimmed" px="md" py="xs" tt="uppercase">
                  {groupName}
                </Text>
                <ul className={classes.list}>{calls.map(renderCallRow)}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className={classes.list}>{items.map(renderCallRow)}</ul>
        )}
      </div>
      <div className={classes.listFooter}>
        <Text size="xs" c="dimmed">
          {total.toLocaleString()} call{total === 1 ? '' : 's'}
          {trashed ? ' in trash' : ''}
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [regionModal, setRegionModal] = useState<{ start: number; end: number } | null>(null);
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
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

  useEffect(() => {
    if (!call.data || call.isError) return;
    void (async () => {
      if (!call.data.is_unread) return;
      try {
        await api.markCallRead(callId);
        await queryClient.invalidateQueries({ queryKey: ['calls'] });
        await queryClient.invalidateQueries({ queryKey: ['call', callId] });
      } catch {
        // Non-blocking; list will refresh on next load.
      }
    })();
  }, [call.data, call.isError, callId, queryClient]);

  const recordings = useQuery({
    queryKey: ['recordings', callId],
    queryFn: () => api.getRecordings(callId),
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      // Near/far monos may be purged after transcription; stereo/mix alone is enough.
      const hasPlayable = items.some(
        (r) =>
          recordingHasMedia(r) &&
          (r.leg === 'stereo' || r.leg === 'mix' || r.leg === 'near' || r.leg === 'far'),
      );
      return hasPlayable ? false : 3000;
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

  const trashCall = useMutation({
    mutationFn: () => api.trashCall(callId),
    onSuccess: async () => {
      setTrashConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['calls'] });
      await queryClient.invalidateQueries({ queryKey: ['call', callId] });
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
  const nearLabel = formatParty(c?.near_name, c?.near_addr);
  const farLabel = formatParty(c?.far_name, c?.far_addr);
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
                {c?.holding && (
                  <Badge color="gray" variant="light">
                    Unconfigured
                  </Badge>
                )}
                {c?.trashed_at && (
                  <Badge color="gray" variant="light" leftSection={<IconTrash size={11} />}>
                    Trash
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                Near: {nearLabel} · Far: {farLabel}
                {c?.duration_s != null ? ` · ${formatTime(c.duration_s)}` : ''}
                {c?.started_at ? ` · ${new Date(c.started_at).toLocaleString()}` : ''}
              </Text>
              {c?.trashed_at && (
                <Alert variant="light" color="orange" icon={<IconInfoCircle size={16} />} mt="sm">
                  In trash — recoverable for about {daysUntilTrashPurge(c.trashed_at)} more day
                  {daysUntilTrashPurge(c.trashed_at) === 1 ? '' : 's'}, then permanently deleted.
                </Alert>
              )}
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

          {canManageRetention && c && (
            <Card padding="md" radius="md">
              <Text fw={600} size="sm" mb={4}>
                Trash
              </Text>
              {c.trashed_at ? (
                <>
                  <Text size="xs" c="dimmed" mb="sm">
                    Restore to return this recording to the active list.
                  </Text>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconRestore size={14} />}
                    loading={restoreCall.isPending}
                    onClick={() => restoreCall.mutate()}
                  >
                    Restore
                  </Button>
                  {restoreCall.isError && (
                    <Text size="xs" c="red" mt="xs">
                      {(restoreCall.error as Error).message}
                    </Text>
                  )}
                </>
              ) : (
                <>
                  <Text size="xs" c="dimmed" mb="sm">
                    Move to trash. Recoverable for {TRASH_RETENTION_DAYS} days.
                  </Text>
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
                        Move to trash
                      </Button>
                    </span>
                  </Tooltip>
                </>
              )}
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

      <Modal
        opened={trashConfirmOpen}
        onClose={() => setTrashConfirmOpen(false)}
        title="Move to trash?"
      >
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const callId = id ? Number(id) : null;
  const holdingOnly = searchParams.get('holding') === 'true';
  const trashOnly = searchParams.get('trashed') === 'true';
  const stats = useQuery({ queryKey: ['dashboard-stats'], queryFn: api.dashboardStats });
  // Below this width the list and detail panes take turns instead of sharing
  // the row — a shrunk three-pane layout reads as cramped, not responsive.
  const isNarrow = !!useMediaQuery('(max-width: 860px)');
  const showList = !isNarrow || callId == null;
  const showDetail = !isNarrow || callId != null;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{trashOnly ? 'Trash' : 'Recordings'}</Title>
        <Group gap="xs">
          {!trashOnly && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconTrash size={14} />}
              onClick={() => navigate('/recordings?trashed=true')}
            >
              View trash
            </Button>
          )}
          {trashOnly && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconArrowLeft size={14} />}
              onClick={() => navigate('/recordings')}
            >
              Back to recordings
            </Button>
          )}
          {isNarrow && callId != null && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconArrowLeft size={14} />}
              onClick={() => navigate(trashOnly ? '/recordings?trashed=true' : '/recordings')}
            >
              Back to list
            </Button>
          )}
        </Group>
      </Group>
      <div className={classes.layout}>
        {showList && <CallList selectedId={callId} holdingOnly={holdingOnly} trashOnly={trashOnly} />}
        {showDetail &&
          (callId != null ? (
            <CallDetail key={callId} callId={callId} />
          ) : (
            <Card padding="md" radius="md">
              <div className={classes.empty}>
                <Text fw={600}>
                  {trashOnly ? 'Select a trashed call to recover it' : 'Select a call to play its recording'}
                </Text>
                <Text size="sm" c="dimmed" mt={4}>
                  {trashOnly
                    ? `Trashed recordings remain recoverable for ${TRASH_RETENTION_DAYS} days.`
                    : stats.data
                      ? `${stats.data.calls_total.toLocaleString()} call${stats.data.calls_total === 1 ? '' : 's'} in this tenant.`
                      : ' '}{' '}
                  {!trashOnly && 'Use the search box or filters on the left, or click any row.'}
                </Text>
              </div>
            </Card>
          ))}
      </div>
    </Stack>
  );
}
