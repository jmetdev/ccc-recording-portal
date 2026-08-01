import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Group, Stack, Switch, Text, Textarea } from '@mantine/core';
import { api, hasPermission } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { CallStatusBadge } from '../../components/CallStatusBadge';
import { ConversationTranscript } from '../../components/ConversationTranscript';
import {
  SENTIMENT_COLORS,
  formatCallSource,
  formatDurationHms,
  formatSentimentLabel,
  longDateTime,
  partyParts,
} from './recordingsShared';
import classes from './Recordings.module.css';

type Tab = 'transcript' | 'notes' | 'details';

type Props = {
  callId: number;
  currentTime?: number;
  onSeek?: (time: number) => void;
};

export function RecordingsExpandPanel({ callId, currentTime = 0, onSeek }: Props) {
  const [tab, setTab] = useState<Tab>('transcript');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canViewTranscripts = hasPermission(user, 'view_transcripts');
  const canManageRetention = hasPermission(user, 'manage_retention');

  const call = useQuery({
    queryKey: ['call', callId],
    queryFn: () => api.getCall(callId),
    enabled: Number.isFinite(callId),
  });

  const transcripts = useQuery({
    queryKey: ['transcripts', callId],
    queryFn: () => api.listTranscripts(callId),
    enabled: Number.isFinite(callId) && canViewTranscripts,
    refetchInterval: call.data?.status === 'transcribing' ? 3000 : false,
  });

  useEffect(() => {
    if (call.data && !notesDirty) {
      setNotesDraft(call.data.notes ?? '');
    }
  }, [call.data, notesDirty]);

  useEffect(() => {
    setNotesDirty(false);
  }, [callId]);

  const saveNotes = useMutation({
    mutationFn: () => api.patchCallNotes(callId, notesDraft || null),
    onSuccess: (updated) => {
      queryClient.setQueryData(['call', callId], updated);
      setNotesDirty(false);
    },
  });

  const legalHold = useMutation({
    mutationFn: (value: boolean) => api.setLegalHold(callId, value),
    onSuccess: () => call.refetch(),
  });

  const c = call.data;
  const near = partyParts(c?.near_name, c?.near_addr);
  const far = partyParts(c?.far_name, c?.far_addr);
  const nearLabel = near.detail ? `${near.name} (${near.detail})` : near.name;
  const farLabel = far.detail ? `${far.name} (${far.detail})` : far.name;
  const transcriptList = transcripts.data ?? [];

  const tabs: { id: Tab; label: string; hidden?: boolean }[] = [
    { id: 'transcript', label: 'Transcript', hidden: !canViewTranscripts },
    { id: 'notes', label: 'Notes' },
    { id: 'details', label: 'Details' },
  ];

  const visibleTabs = tabs.filter((t) => !t.hidden);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id ?? 'notes';

  return (
    <div className={classes.expandPanel}>
      <div className={classes.expandTabBar} role="tablist">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`${classes.expandTab}${activeTab === t.id ? ` ${classes.expandTabActive}` : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={classes.expandBody}>
        {activeTab === 'transcript' && canViewTranscripts && (
          <Stack gap="sm">
            {transcripts.isLoading && (
              <Text size="sm" c="dimmed">
                Loading…
              </Text>
            )}
            {c?.status === 'transcribing' && (
              <Text size="sm" c="dimmed">
                Transcription in progress…
              </Text>
            )}
            {!transcripts.isLoading && transcriptList.length === 0 && c?.status === 'completed' && (
              <Text size="sm" c="dimmed">
                No transcript available for this call.
              </Text>
            )}
            <ConversationTranscript
              transcripts={transcriptList}
              nearLabel={nearLabel}
              farLabel={farLabel}
              currentTime={currentTime}
              onSeek={onSeek}
              maxHeight={360}
              layout="timeline"
            />
          </Stack>
        )}

        {activeTab === 'notes' && (
          <Stack gap="sm">
            <Textarea
              value={notesDraft}
              onChange={(e) => {
                setNotesDraft(e.currentTarget.value);
                setNotesDirty(true);
              }}
              placeholder="Add notes about this call…"
              autosize
              minRows={5}
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
              <Text size="xs" c="red">
                {(saveNotes.error as Error).message}
              </Text>
            )}
          </Stack>
        )}

        {activeTab === 'details' && c && (
          <div className={classes.detailsGrid}>
            <div className={classes.detailsRow}>
              <Text className={classes.detailsLabel}>Date & time</Text>
              <Text className={classes.detailsValue}>
                {c.started_at ? longDateTime(c.started_at) : '—'}
              </Text>
            </div>
            <div className={classes.detailsRow}>
              <Text className={classes.detailsLabel}>Duration</Text>
              <Text className={classes.detailsValue}>
                {c.duration_s != null ? formatDurationHms(c.duration_s) : '—'}
              </Text>
            </div>
            <div className={classes.detailsRow}>
              <Text className={classes.detailsLabel}>Source</Text>
              <Text className={classes.detailsValue}>{formatCallSource(c.source)}</Text>
            </div>
            <div className={classes.detailsRow}>
              <Text className={classes.detailsLabel}>Status</Text>
              <div className={classes.detailsValue}>
                <CallStatusBadge status={c.status} radius="sm" />
              </div>
            </div>
            {c.sentiment && (
              <div className={classes.detailsRow}>
                <Text className={classes.detailsLabel}>Sentiment</Text>
                <div className={classes.detailsValue}>
                  <Badge
                    size="sm"
                    variant="light"
                    radius="sm"
                    color={SENTIMENT_COLORS[c.sentiment] ?? 'gray'}
                  >
                    {formatSentimentLabel(c.sentiment)}
                  </Badge>
                </div>
              </div>
            )}
            <div className={classes.detailsRow}>
              <Text className={classes.detailsLabel}>Near</Text>
              <Text className={classes.detailsValue}>{nearLabel}</Text>
            </div>
            <div className={classes.detailsRow}>
              <Text className={classes.detailsLabel}>Far</Text>
              <Text className={classes.detailsValue}>{farLabel}</Text>
            </div>
            <div className={classes.detailsRow}>
              <Text className={classes.detailsLabel}>Legal hold</Text>
              <div className={classes.detailsValue}>
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
            {c.group_name && (
              <div className={classes.detailsRow}>
                <Text className={classes.detailsLabel}>Group</Text>
                <Text className={classes.detailsValue}>{c.group_name}</Text>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
