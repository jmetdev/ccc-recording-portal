import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Slider,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconDownload,
  IconExternalLink,
  IconMail,
  IconMailOpened,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { api, hasPermission } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { CallStatusBadge } from '../../components/CallStatusBadge';
import { DualChannelWaveform } from '../../components/DualChannelWaveform';
import type { Call } from '../../api/client';
import {
  SENTIMENT_COLORS,
  TRASH_RETENTION_DAYS,
  callTitle,
  formatCallSource,
  formatDurationHms,
  formatSentimentLabel,
  longDateTime,
  partyParts,
} from './recordingsShared';
import { useCallMedia } from './useCallMedia';
import classes from './Recordings.module.css';

type Props = {
  callId: number;
  trashOnly?: boolean;
  onTrashed?: () => void;
};

function DataGridItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={classes.dataGridItem}>
      <Text className={classes.dataGridLabel}>{label}</Text>
      <div className={classes.dataGridValue}>{children}</div>
    </div>
  );
}

export function SelectedCallPlayer({ callId, trashOnly = false, onTrashed }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManageRetention = hasPermission(user, 'manage_retention');
  const [downloading, setDownloading] = useState(false);
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);

  const media = useCallMedia(callId);
  const c = media.call.data;

  const markUnread = useMutation({
    mutationFn: () => api.markCallUnread(callId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calls'] });
      queryClient.setQueryData(['call', callId], (prev: Call | undefined) =>
        prev ? { ...prev, is_unread: true } : prev,
      );
    },
  });

  const trashCall = useMutation({
    mutationFn: () => api.trashCall(callId),
    onSuccess: async () => {
      setTrashConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['calls'] });
      onTrashed?.();
    },
  });

  const near = partyParts(c?.near_name, c?.near_addr);
  const far = partyParts(c?.far_name, c?.far_addr);
  const nearLabel = near.detail ? `${near.name} (${near.detail})` : near.name;
  const farLabel = far.detail ? `${far.name} (${far.detail})` : far.name;

  const downloadAudio = async () => {
    if (!media.downloadRecording) return;
    setDownloading(true);
    try {
      await api.downloadRecording(media.downloadRecording.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const detailHref = trashOnly ? `/recordings/${callId}?trashed=true` : `/recordings/${callId}`;

  return (
    <div className={classes.playerStrip}>
      <div className={classes.playerHeader}>
        <div>
          <Title order={4} className={classes.playerTitle}>
            {c ? callTitle(c) : 'Recording'}
          </Title>
          {c?.started_at && (
            <Text size="xs" c="dimmed" mt={4}>
              {longDateTime(c.started_at)}
            </Text>
          )}
        </div>
        <Group gap={6} wrap="nowrap">
          {media.hasAudio && (
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
          <Button
            component={Link}
            to={detailHref}
            size="xs"
            variant="light"
            leftSection={<IconExternalLink size={14} />}
          >
            Open full page
          </Button>
        </Group>
      </div>

      {media.hasAudio ? (
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
            nearRecording={media.nearRecording}
            farRecording={media.farRecording}
            stereoRecording={media.stereoRecording}
            mixRecording={media.mixRecording}
            audioUrl={api.audioUrl}
            nearLabel={nearLabel}
            farLabel={farLabel}
            onTimeUpdate={media.setCurrentTime}
            onDuration={media.setDuration}
            onPlayingChange={media.setPlaying}
            seekTo={media.seekTo}
            playSignal={media.playSignal}
            pauseSignal={media.pauseSignal}
          />
          <div className={classes.transport}>
            <ActionIcon
              variant="filled"
              size="lg"
              radius="xl"
              onClick={media.togglePlay}
              aria-label="Play or pause"
            >
              {media.playing ? <IconPlayerPause size={20} /> : <IconPlayerPlay size={20} />}
            </ActionIcon>
            <Text size="xs" c="dimmed" ff="monospace" style={{ width: 52 }}>
              {formatDurationHms(media.currentTime)}
            </Text>
            <Slider
              style={{ flex: 1 }}
              value={media.durationSeconds ? (media.currentTime / media.durationSeconds) * 100 : 0}
              onChange={media.onSeek}
              disabled={!media.durationSeconds}
              size="sm"
              label={(v) =>
                media.durationSeconds ? formatDurationHms((v / 100) * media.durationSeconds) : null
              }
              color="brandBlue"
            />
            <Text size="xs" c="dimmed" ff="monospace" style={{ width: 52, textAlign: 'right' }}>
              {formatDurationHms(media.durationSeconds)}
            </Text>
          </div>
        </Stack>
      ) : (
        <Text size="sm" c="dimmed" py="sm">
          {media.recordings.isLoading
            ? 'Loading recordings…'
            : c?.status === 'recording'
              ? 'Call is being recorded…'
              : c?.status === 'processing'
                ? 'Recording is being processed…'
                : 'No audio available for this call.'}
        </Text>
      )}

      {c && (
        <div className={classes.dataGrid}>
          <DataGridItem label="Summary">
            <Text size="sm" lineClamp={2}>
              {c.summary || '—'}
            </Text>
          </DataGridItem>
          <DataGridItem label="Source">
            <Text size="sm">{formatCallSource(c.source)}</Text>
          </DataGridItem>
          <DataGridItem label="Status">
            <CallStatusBadge status={c.status} size="sm" radius="sm" />
          </DataGridItem>
          <DataGridItem label="Sentiment">
            {c.sentiment ? (
              <Badge
                size="sm"
                variant="light"
                radius="sm"
                color={SENTIMENT_COLORS[c.sentiment] ?? 'gray'}
              >
                {formatSentimentLabel(c.sentiment)}
              </Badge>
            ) : (
              <Text size="sm">—</Text>
            )}
          </DataGridItem>
          <DataGridItem label="Near">
            <Text size="sm" truncate>
              {nearLabel}
            </Text>
          </DataGridItem>
          <DataGridItem label="Far">
            <Text size="sm" truncate>
              {farLabel}
            </Text>
          </DataGridItem>
        </div>
      )}

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
    </div>
  );
}
