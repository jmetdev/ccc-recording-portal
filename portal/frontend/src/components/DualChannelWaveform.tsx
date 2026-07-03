import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Box, Group, Stack, Text } from '@mantine/core';
import { IconVolume, IconVolumeOff } from '@tabler/icons-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { authHeaders, Recording, Tag } from '../api/client';

const NEAR_COLOR = '#2b87d4';
const FAR_COLOR = '#43a3eb';
const NEAR_PROGRESS = '#195184';
const FAR_PROGRESS = '#226cac';

type ChannelMute = { near: boolean; far: boolean };

type Props = {
  nearRecording: Recording | null;
  farRecording: Recording | null;
  stereoRecording: Recording | null;
  audioUrl: (recordingId: number) => string;
  nearLabel: string;
  farLabel: string;
  tags?: Tag[];
  canTag?: boolean;
  onRegionSelected?: (start: number, end: number) => void;
  onTimeUpdate?: (time: number) => void;
  onDuration?: (duration: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Controlled seek from parent transport */
  seekTo?: number | null;
  playSignal?: number;
  pauseSignal?: number;
  tagSelectSignal?: number;
};

function applyStereoMute(graph: { nearGain: GainNode; farGain: GainNode } | null, mute: ChannelMute) {
  if (!graph) return;
  graph.nearGain.gain.value = mute.near ? 0 : 1;
  graph.farGain.gain.value = mute.far ? 0 : 1;
}

export function DualChannelWaveform({
  nearRecording,
  farRecording,
  stereoRecording,
  audioUrl,
  nearLabel,
  farLabel,
  tags = [],
  canTag = false,
  onRegionSelected,
  onTimeUpdate,
  onDuration,
  onPlayingChange,
  seekTo,
  playSignal,
  pauseSignal,
  tagSelectSignal,
}: Props) {
  const nearContainerRef = useRef<HTMLDivElement>(null);
  const farContainerRef = useRef<HTMLDivElement>(null);
  const stereoContainerRef = useRef<HTMLDivElement>(null);
  const nearWsRef = useRef<WaveSurfer | null>(null);
  const farWsRef = useRef<WaveSurfer | null>(null);
  const stereoWsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const audioGraphRef = useRef<{ ctx: AudioContext; nearGain: GainNode; farGain: GainNode } | null>(null);
  const muteRef = useRef<ChannelMute>({ near: false, far: false });

  const [nearMuted, setNearMuted] = useState(false);
  const [farMuted, setFarMuted] = useState(false);

  const dualMono = !!(nearRecording?.path_m4a && farRecording?.path_m4a);
  const stereoMode = !dualMono && !!stereoRecording?.path_m4a;
  const singleRecording = dualMono ? null : farRecording?.path_m4a ? farRecording : nearRecording?.path_m4a ? nearRecording : stereoRecording;

  const renderTags = useCallback(
    (regions: ReturnType<typeof RegionsPlugin.create>) => {
      regions.clearRegions();
      tags.forEach((t) => {
        regions.addRegion({
          start: t.start_s,
          end: t.end_s,
          color: 'rgba(43, 135, 212, 0.25)',
          content: t.note || undefined,
          drag: false,
          resize: false,
        });
      });
    },
    [tags],
  );

  const wireWsEvents = useCallback(
    (ws: WaveSurfer, regions?: ReturnType<typeof RegionsPlugin.create>) => {
      ws.on('play', () => onPlayingChange?.(true));
      ws.on('pause', () => onPlayingChange?.(false));
      ws.on('timeupdate', (t) => onTimeUpdate?.(t));
      ws.on('ready', () => {
        onDuration?.(ws.getDuration());
        if (regions) renderTags(regions);
      });
      if (canTag && regions) {
        regions.on('region-created', (region) => {
          onRegionSelected?.(region.start, region.end);
          region.remove();
        });
      }
    },
    [canTag, onDuration, onPlayingChange, onRegionSelected, onTimeUpdate, renderTags],
  );

  // Dual mono: separate near + far recordings, synced playback
  useEffect(() => {
    if (!dualMono || !nearContainerRef.current || !farContainerRef.current) return;
    if (!nearRecording?.path_m4a || !farRecording?.path_m4a) return;

    nearContainerRef.current.replaceChildren();
    farContainerRef.current.replaceChildren();

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const nearWs = WaveSurfer.create({
      container: nearContainerRef.current,
      url: audioUrl(nearRecording.id),
      fetchParams: { headers: authHeaders() },
      height: 56,
      barWidth: 2,
      waveColor: NEAR_COLOR,
      progressColor: NEAR_PROGRESS,
      normalize: true,
    });
    const farWs = WaveSurfer.create({
      container: farContainerRef.current,
      url: audioUrl(farRecording.id),
      fetchParams: { headers: authHeaders() },
      height: 56,
      barWidth: 2,
      waveColor: FAR_COLOR,
      progressColor: FAR_PROGRESS,
      normalize: true,
      plugins: [regions],
    });

    nearWsRef.current = nearWs;
    farWsRef.current = farWs;

    const syncFromFar = (time: number) => {
      if (Math.abs(nearWs.getCurrentTime() - time) > 0.05) {
        nearWs.setTime(time);
      }
    };

    wireWsEvents(farWs, regions);
    wireWsEvents(nearWs);
    farWs.on('timeupdate', syncFromFar);
    farWs.on('seeking', syncFromFar);

    nearWs.setVolume(nearMuted ? 0 : 1);
    farWs.setVolume(farMuted ? 0 : 1);

    return () => {
      nearWs.destroy();
      farWs.destroy();
      nearWsRef.current = null;
      farWsRef.current = null;
      regionsRef.current = null;
    };
  }, [
    dualMono,
    nearRecording?.id,
    farRecording?.id,
    nearRecording?.path_m4a,
    farRecording?.path_m4a,
    audioUrl,
    wireWsEvents,
    nearMuted,
    farMuted,
  ]);

  // Stereo: split L/R waveforms with Web Audio per-channel mute
  useEffect(() => {
    if (!stereoMode || !stereoContainerRef.current || !stereoRecording?.path_m4a) return;

    stereoContainerRef.current.replaceChildren();
    audioGraphRef.current = null;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: stereoContainerRef.current,
      url: audioUrl(stereoRecording.id),
      fetchParams: { headers: authHeaders() },
      height: 112,
      barWidth: 2,
      normalize: true,
      splitChannels: [
        { overlay: false, waveColor: NEAR_COLOR, progressColor: NEAR_PROGRESS },
        { overlay: false, waveColor: FAR_COLOR, progressColor: FAR_PROGRESS },
      ],
      plugins: [regions],
    });
    stereoWsRef.current = ws;

    wireWsEvents(ws, regions);

    ws.on('ready', () => {
      try {
        const media = ws.getMediaElement();
        media.crossOrigin = 'anonymous';
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(media);
        const splitter = ctx.createChannelSplitter(2);
        const nearGain = ctx.createGain();
        const farGain = ctx.createGain();
        source.connect(splitter);
        splitter.connect(nearGain, 0);
        splitter.connect(farGain, 1);
        nearGain.connect(ctx.destination);
        farGain.connect(ctx.destination);
        audioGraphRef.current = { ctx, nearGain, farGain };
        applyStereoMute(audioGraphRef.current, muteRef.current);
      } catch {
        // Fallback: whole-track volume only if graph setup fails
        audioGraphRef.current = null;
      }
    });

    return () => {
      ws.destroy();
      stereoWsRef.current = null;
      regionsRef.current = null;
      audioGraphRef.current?.ctx.close().catch(() => undefined);
      audioGraphRef.current = null;
    };
  }, [stereoMode, stereoRecording?.id, stereoRecording?.path_m4a, audioUrl, wireWsEvents]);

  // Single channel fallback
  useEffect(() => {
    if (dualMono || stereoMode || !stereoContainerRef.current || !singleRecording?.path_m4a) return;

    stereoContainerRef.current.replaceChildren();
    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: stereoContainerRef.current,
      url: audioUrl(singleRecording.id),
      fetchParams: { headers: authHeaders() },
      height: 96,
      barWidth: 2,
      waveColor: FAR_COLOR,
      progressColor: FAR_PROGRESS,
      normalize: true,
      plugins: [regions],
    });
    stereoWsRef.current = ws;
    wireWsEvents(ws, regions);

    return () => {
      ws.destroy();
      stereoWsRef.current = null;
      regionsRef.current = null;
    };
  }, [dualMono, stereoMode, singleRecording?.id, singleRecording?.path_m4a, audioUrl, wireWsEvents]);

  useEffect(() => {
    if (regionsRef.current) renderTags(regionsRef.current);
  }, [tags, renderTags]);

  useEffect(() => {
    muteRef.current = { near: nearMuted, far: farMuted };
    if (dualMono) {
      nearWsRef.current?.setVolume(nearMuted ? 0 : 1);
      farWsRef.current?.setVolume(farMuted ? 0 : 1);
    } else if (stereoMode) {
      applyStereoMute(audioGraphRef.current, { near: nearMuted, far: farMuted });
    }
  }, [nearMuted, farMuted, dualMono, stereoMode]);

  useEffect(() => {
    if (seekTo == null) return;
    nearWsRef.current?.setTime(seekTo);
    farWsRef.current?.setTime(seekTo);
    stereoWsRef.current?.setTime(seekTo);
  }, [seekTo]);

  useEffect(() => {
    if (playSignal == null) return;
    const resume = async () => {
      await audioGraphRef.current?.ctx.resume();
      if (dualMono) {
        await nearWsRef.current?.play();
        await farWsRef.current?.play();
      } else {
        await stereoWsRef.current?.play();
      }
    };
    resume().catch(() => undefined);
  }, [playSignal, dualMono]);

  useEffect(() => {
    if (pauseSignal == null) return;
    nearWsRef.current?.pause();
    farWsRef.current?.pause();
    stereoWsRef.current?.pause();
  }, [pauseSignal]);

  useEffect(() => {
    if (!tagSelectSignal) return;
    regionsRef.current?.enableDragSelection({ color: 'rgba(43, 135, 212, 0.3)' });
  }, [tagSelectSignal]);

  const toggleNearMute = () => setNearMuted((v) => !v);
  const toggleFarMute = () => setFarMuted((v) => !v);

  const showMuteControls = dualMono || stereoMode;

  return (
    <Stack gap={4}>
      {dualMono && (
        <Stack gap={2}>
          <ChannelRow
            label={`Near · ${nearLabel}`}
            color={NEAR_COLOR}
            muted={nearMuted}
            onToggleMute={toggleNearMute}
            showMute={showMuteControls}
          />
          <Box ref={nearContainerRef} style={{ height: 56 }} />
          <ChannelRow
            label={`Far · ${farLabel}`}
            color={FAR_COLOR}
            muted={farMuted}
            onToggleMute={toggleFarMute}
            showMute={showMuteControls}
          />
          <Box ref={farContainerRef} style={{ height: 56 }} />
        </Stack>
      )}
      {!dualMono && (
        <>
          {stereoMode && (
            <Group justify="space-between" wrap="nowrap">
              <Group gap="lg">
                <ChannelMuteLabel label={`Near · ${nearLabel}`} color={NEAR_COLOR} muted={nearMuted} onToggle={toggleNearMute} />
                <ChannelMuteLabel label={`Far · ${farLabel}`} color={FAR_COLOR} muted={farMuted} onToggle={toggleFarMute} />
              </Group>
            </Group>
          )}
          <Box ref={stereoContainerRef} style={{ height: stereoMode ? 112 : 96 }} />
        </>
      )}
    </Stack>
  );
}

function ChannelRow({
  label,
  color,
  muted,
  onToggleMute,
  showMute,
}: {
  label: string;
  color: string;
  muted: boolean;
  onToggleMute: () => void;
  showMute: boolean;
}) {
  return (
    <Group justify="space-between" gap="xs">
      <Text size="xs" c={color} fw={600}>
        {label}
      </Text>
      {showMute && <MuteButton muted={muted} onToggle={onToggleMute} label={label} />}
    </Group>
  );
}

function ChannelMuteLabel({
  label,
  color,
  muted,
  onToggle,
}: {
  label: string;
  color: string;
  muted: boolean;
  onToggle: () => void;
}) {
  return (
    <Group gap={4}>
      <Text size="xs" c={color} fw={600}>
        {label}
      </Text>
      <MuteButton muted={muted} onToggle={onToggle} label={label} />
    </Group>
  );
}

function MuteButton({ muted, onToggle, label }: { muted: boolean; onToggle: () => void; label: string }) {
  return (
    <ActionIcon
      size="sm"
      variant={muted ? 'filled' : 'subtle'}
      color={muted ? 'gray' : 'blue'}
      onClick={onToggle}
      aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
    >
      {muted ? <IconVolumeOff size={14} /> : <IconVolume size={14} />}
    </ActionIcon>
  );
}
