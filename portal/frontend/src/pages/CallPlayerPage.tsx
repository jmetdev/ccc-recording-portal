import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Group, Stack, Text, Textarea, Title } from '@mantine/core';
import { useWavesurfer } from '@wavesurfer/react';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { api, Tag } from '../api/client';

export function CallPlayerPage() {
  const { id } = useParams();
  const callId = Number(id);
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const [note, setNote] = useState('');
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);

  const call = useQuery({ queryKey: ['call', callId], queryFn: () => api.getCall(callId), enabled: !!callId });
  const recordings = useQuery({
    queryKey: ['recordings', callId],
    queryFn: () => api.getRecordings(callId),
    enabled: !!callId,
  });
  const tags = useQuery({ queryKey: ['tags', callId], queryFn: () => api.getTags(callId), enabled: !!callId });

  const stereo = useMemo(() => recordings.data?.find((r) => r.leg === 'stereo'), [recordings.data]);

  const plugins = useMemo(() => {
    const regions = RegionsPlugin.create();
    regionsRef.current = regions;
    return [regions];
  }, []);

  const { wavesurfer } = useWavesurfer({
    container: containerRef,
    url: stereo ? api.audioUrl(stereo.id) : undefined,
    waveColor: '#128feb',
    progressColor: '#0a558d',
    height: 120,
    splitChannels: [
      { overlay: false, waveColor: '#2b87d4', progressColor: '#195184' },
      { overlay: false, waveColor: '#43a3eb', progressColor: '#226cac' },
    ],
    normalize: true,
    plugins,
  });

  const addTag = useMutation({
    mutationFn: () =>
      api.createTag({
        call_id: callId,
        recording_id: stereo?.id ?? null,
        channel: 'mix',
        start_s: selection!.start,
        end_s: selection!.end,
        note: note || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags', callId] });
      setNote('');
      setSelection(null);
    },
  });

  const onRegionCreated = useCallback((region: { start: number; end: number }) => {
    setSelection({ start: region.start, end: region.end });
  }, []);

  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    regions.on('region-created', onRegionCreated);
    return () => regions.un('region-created', onRegionCreated);
  }, [onRegionCreated, wavesurfer]);

  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !tags.data) return;
    regions.clearRegions();
    tags.data.forEach((t: Tag) => {
      regions.addRegion({
        id: String(t.id),
        start: t.start_s,
        end: t.end_s,
        color: 'rgba(18, 143, 235, 0.25)',
        content: t.note || undefined,
      });
    });
  }, [tags.data, wavesurfer]);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={2}>Call #{callId}</Title>
          <Text c="dimmed">
            {call.data?.near_name || call.data?.near_addr} ↔ {call.data?.far_name || call.data?.far_addr}
          </Text>
        </div>
        <Badge>{call.data?.status}</Badge>
      </Group>

      <Card withBorder padding="md">
        <Text size="sm" mb="xs" c="dimmed">
          Near (L) / Far (R) — drag on waveform to tag a region
        </Text>
        <div ref={containerRef} />
        {!stereo && <Text c="dimmed">Stereo recording not ready yet</Text>}
      </Card>

      {selection && (
        <Card withBorder padding="md">
          <Stack gap="sm">
            <Text size="sm">
              Selected {selection.start.toFixed(1)}s – {selection.end.toFixed(1)}s
            </Text>
            <Textarea placeholder="Tag note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button onClick={() => addTag.mutate()} loading={addTag.isPending}>
              Save tag
            </Button>
          </Stack>
        </Card>
      )}

      <Card withBorder padding="md">
        <Title order={5} mb="sm">
          Tags
        </Title>
        {tags.data?.length ? (
          tags.data.map((t) => (
            <Text key={t.id} size="sm">
              {t.start_s.toFixed(1)}–{t.end_s.toFixed(1)}s: {t.note || '(no note)'}
            </Text>
          ))
        ) : (
          <Text c="dimmed" size="sm">
            No tags yet
          </Text>
        )}
      </Card>
    </Stack>
  );
}
