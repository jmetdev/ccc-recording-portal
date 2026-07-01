import { useEffect, useRef, useState } from 'react';
import { Box, Button, Group, Stack, Text, Textarea, Modal } from '@mantine/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { api, Call, Recording, Tag } from '../api/client';

type Props = {
  call: Call;
};

const NEAR_COLOR = '#2b87d4';
const FAR_COLOR = '#43a3eb';

export function DualChannelPlayer({ call }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [stereo, setStereo] = useState<Recording | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [regionModal, setRegionModal] = useState<{ start: number; end: number } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    api.listRecordings(call.id).then((recs) => {
      setStereo(recs.find((r) => r.leg === 'stereo') ?? recs[0] ?? null);
    });
    api.listTags(call.id).then(setTags).catch(() => setTags([]));
  }, [call.id]);

  useEffect(() => {
    if (!stereo || !containerRef.current) return;

    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: api.audioUrl(stereo.id),
      height: 160,
      splitChannels: [
        { overlay: false, waveColor: NEAR_COLOR, progressColor: '#195184', label: `Near: ${call.near_name || call.near_addr || '?'}` },
        { overlay: false, waveColor: FAR_COLOR, progressColor: '#226cac', label: `Far: ${call.far_name || call.far_addr || '?'}` },
      ],
      plugins: [regions],
    });
    wsRef.current = ws;

    regions.on('region-created', (region) => {
      setRegionModal({ start: region.start, end: region.end });
      region.remove();
    });

    tags.forEach((t) => {
      regions.addRegion({
        start: t.start_s,
        end: t.end_s,
        color: 'rgba(43, 135, 212, 0.25)',
        content: t.note || undefined,
      });
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [stereo?.id, call.id, tags]);

  const enableDrag = () => {
    const ws = wsRef.current;
    if (!ws) return;
    const plugins = ws.getActivePlugins();
    const regions = plugins[0] as InstanceType<typeof RegionsPlugin>;
    regions.enableDragSelection({ color: 'rgba(43, 135, 212, 0.3)' });
  };

  const saveTag = async () => {
    if (!regionModal || !stereo) return;
    await api.createTag({
      call_id: call.id,
      recording_id: stereo.id,
      channel: 'mix',
      start_s: regionModal.start,
      end_s: regionModal.end,
      note: note || null,
    });
    setRegionModal(null);
    setNote('');
    setTags(await api.listTags(call.id));
  };

  if (!stereo) {
    return <Text c="dimmed">Stereo recording not yet available.</Text>;
  }

  return (
    <Stack gap="sm">
      <Group>
        <Button size="xs" variant="light" onClick={enableDrag}>Add tag region</Button>
        <Button size="xs" variant="subtle" onClick={() => wsRef.current?.playPause()}>Play / Pause</Button>
      </Group>
      <Box ref={containerRef} />
      <Modal opened={!!regionModal} onClose={() => setRegionModal(null)} title="Tag region">
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} mb="md" />
        <Button onClick={saveTag}>Save tag</Button>
      </Modal>
    </Stack>
  );
}
