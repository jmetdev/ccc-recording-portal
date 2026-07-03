import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Box, Group, Stack, Text } from '@mantine/core';
import { IconVolume, IconVolumeOff } from '@tabler/icons-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { authHeaders, Recording, Tag } from '../api/client';

export const NEAR_COLOR = '#2b87d4';
export const FAR_COLOR = '#e8590c';
const NEAR_PROGRESS = '#195184';
const FAR_PROGRESS = '#a63f08';

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

/**
 * The audio endpoint requires an Authorization header, which an <audio src=…>
 * element cannot send. Fetch the file with auth and expose it as a blob URL.
 */
function useAudioBlobUrl(recordingId: number | null, audioUrl: (id: number) => string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (recordingId == null) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objUrl: string | null = null;
    (async () => {
      try {
        const resp = await fetch(audioUrl(recordingId), { headers: authHeaders() });
        if (!resp.ok) throw new Error(`audio fetch failed: ${resp.status}`);
        const blob = await resp.blob();
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);
        setUrl(objUrl);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
      setUrl(null);
    };
  }, [recordingId, audioUrl]);

  return url;
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
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const nearContainerRef = useRef<HTMLDivElement>(null);
  const farContainerRef = useRef<HTMLDivElement>(null);
  const mainWsRef = useRef<WaveSurfer | null>(null);
  const nearWsRef = useRef<WaveSurfer | null>(null);
  const farWsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const audioGraphRef = useRef<{ ctx: AudioContext; nearGain: GainNode; farGain: GainNode } | null>(null);
  const muteRef = useRef<ChannelMute>({ near: false, far: false });

  const [nearMuted, setNearMuted] = useState(false);
  const [farMuted, setFarMuted] = useState(false);

  // The stereo mix is one audio element with near on L / far on R, so it plays
  // in perfect sync and supports per-channel mute via a channel splitter.
  // Separate leg files are only a fallback for calls without a stereo mix.
  const stereoMode = !!stereoRecording?.path_m4a;
  const dualMono = !stereoMode && !!(nearRecording?.path_m4a && farRecording?.path_m4a);
  const singleRecording = !stereoMode && !dualMono
    ? (farRecording?.path_m4a ? farRecording : nearRecording?.path_m4a ? nearRecording : null)
    : null;
  const singleLeg: 'near' | 'far' = singleRecording === nearRecording ? 'near' : 'far';

  const stereoUrl = useAudioBlobUrl(stereoMode ? stereoRecording!.id : null, audioUrl);
  const nearUrl = useAudioBlobUrl(dualMono ? nearRecording!.id : null, audioUrl);
  const farUrl = useAudioBlobUrl(dualMono ? farRecording!.id : null, audioUrl);
  const singleUrl = useAudioBlobUrl(singleRecording ? singleRecording.id : null, audioUrl);

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
      ws.on('finish', () => onPlayingChange?.(false));
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

  // Preferred: stereo mix — split L/R waveforms, Web Audio per-channel mute.
  useEffect(() => {
    if (!stereoMode || !mainContainerRef.current || !stereoUrl) return;

    mainContainerRef.current.replaceChildren();
    audioGraphRef.current = null;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: mainContainerRef.current,
      url: stereoUrl,
      height: 112,
      barWidth: 2,
      normalize: true,
      splitChannels: [
        { overlay: false, waveColor: NEAR_COLOR, progressColor: NEAR_PROGRESS },
        { overlay: false, waveColor: FAR_COLOR, progressColor: FAR_PROGRESS },
      ],
      plugins: [regions],
    });
    mainWsRef.current = ws;

    wireWsEvents(ws, regions);

    ws.on('ready', () => {
      try {
        const media = ws.getMediaElement();
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(media);
        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createChannelMerger(2);
        const nearGain = ctx.createGain();
        const farGain = ctx.createGain();
        source.connect(splitter);
        splitter.connect(nearGain, 0);
        splitter.connect(farGain, 1);
        nearGain.connect(merger, 0, 0);
        nearGain.connect(merger, 0, 1);
        farGain.connect(merger, 0, 0);
        farGain.connect(merger, 0, 1);
        merger.connect(ctx.destination);
        audioGraphRef.current = { ctx, nearGain, farGain };
        applyStereoMute(audioGraphRef.current, muteRef.current);
      } catch {
        // Fallback: whole-track volume only if graph setup fails
        audioGraphRef.current = null;
      }
    });

    return () => {
      ws.destroy();
      mainWsRef.current = null;
      regionsRef.current = null;
      audioGraphRef.current?.ctx.close().catch(() => undefined);
      audioGraphRef.current = null;
    };
  }, [stereoMode, stereoUrl, wireWsEvents]);

  // Fallback: separate near + far files, far drives the clock.
  useEffect(() => {
    if (!dualMono || !nearContainerRef.current || !farContainerRef.current) return;
    if (!nearUrl || !farUrl) return;

    nearContainerRef.current.replaceChildren();
    farContainerRef.current.replaceChildren();

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const nearWs = WaveSurfer.create({
      container: nearContainerRef.current,
      url: nearUrl,
      height: 56,
      barWidth: 2,
      waveColor: NEAR_COLOR,
      progressColor: NEAR_PROGRESS,
      normalize: true,
    });
    const farWs = WaveSurfer.create({
      container: farContainerRef.current,
      url: farUrl,
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
    farWs.on('timeupdate', syncFromFar);
    farWs.on('seeking', syncFromFar);

    // Apply current mute state without re-creating players on toggle.
    nearWs.setVolume(muteRef.current.near ? 0 : 1);
    farWs.setVolume(muteRef.current.far ? 0 : 1);

    return () => {
      nearWs.destroy();
      farWs.destroy();
      nearWsRef.current = null;
      farWsRef.current = null;
      regionsRef.current = null;
    };
  }, [dualMono, nearUrl, farUrl, wireWsEvents]);

  // Fallback: a single leg only.
  useEffect(() => {
    if (stereoMode || dualMono || !mainContainerRef.current || !singleUrl) return;

    mainContainerRef.current.replaceChildren();
    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: mainContainerRef.current,
      url: singleUrl,
      height: 96,
      barWidth: 2,
      waveColor: singleLeg === 'near' ? NEAR_COLOR : FAR_COLOR,
      progressColor: singleLeg === 'near' ? NEAR_PROGRESS : FAR_PROGRESS,
      normalize: true,
      plugins: [regions],
    });
    mainWsRef.current = ws;
    wireWsEvents(ws, regions);

    return () => {
      ws.destroy();
      mainWsRef.current = null;
      regionsRef.current = null;
    };
  }, [stereoMode, dualMono, singleUrl, singleLeg, wireWsEvents]);

  useEffect(() => {
    if (regionsRef.current) renderTags(regionsRef.current);
  }, [tags, renderTags]);

  useEffect(() => {
    muteRef.current = { near: nearMuted, far: farMuted };
    if (stereoMode) {
      applyStereoMute(audioGraphRef.current, muteRef.current);
    } else if (dualMono) {
      nearWsRef.current?.setVolume(nearMuted ? 0 : 1);
      farWsRef.current?.setVolume(farMuted ? 0 : 1);
    }
  }, [nearMuted, farMuted, stereoMode, dualMono]);

  useEffect(() => {
    if (seekTo == null) return;
    mainWsRef.current?.setTime(seekTo);
    nearWsRef.current?.setTime(seekTo);
    farWsRef.current?.setTime(seekTo);
  }, [seekTo]);

  useEffect(() => {
    if (playSignal == null) return;
    const resume = async () => {
      await audioGraphRef.current?.ctx.resume();
      if (dualMono) {
        await nearWsRef.current?.play();
        await farWsRef.current?.play();
      } else {
        await mainWsRef.current?.play();
      }
    };
    resume().catch(() => undefined);
  }, [playSignal, dualMono]);

  useEffect(() => {
    if (pauseSignal == null) return;
    mainWsRef.current?.pause();
    nearWsRef.current?.pause();
    farWsRef.current?.pause();
  }, [pauseSignal]);

  useEffect(() => {
    if (!tagSelectSignal) return;
    regionsRef.current?.enableDragSelection({ color: 'rgba(43, 135, 212, 0.3)' });
  }, [tagSelectSignal]);

  const nearAvailable = stereoMode || dualMono || singleLeg === 'near';
  const farAvailable = stereoMode || dualMono || singleLeg === 'far';

  return (
    <Stack gap={4}>
      <Group gap="lg" wrap="nowrap">
        <ChannelHeader
          label={`Near · ${nearLabel}`}
          color={NEAR_COLOR}
          muted={nearMuted}
          onToggle={() => setNearMuted((v) => !v)}
          available={nearAvailable}
        />
        <ChannelHeader
          label={`Far · ${farLabel}`}
          color={FAR_COLOR}
          muted={farMuted}
          onToggle={() => setFarMuted((v) => !v)}
          available={farAvailable}
        />
      </Group>
      {dualMono ? (
        <Stack gap={6}>
          <Box ref={nearContainerRef} style={{ height: 56, minHeight: 56 }} />
          <Box ref={farContainerRef} style={{ height: 56, minHeight: 56 }} />
        </Stack>
      ) : (
        <Box ref={mainContainerRef} style={{ height: stereoMode ? 112 : 96, minHeight: stereoMode ? 112 : 96 }} />
      )}
    </Stack>
  );
}

function ChannelHeader({
  label,
  color,
  muted,
  onToggle,
  available,
}: {
  label: string;
  color: string;
  muted: boolean;
  onToggle: () => void;
  available: boolean;
}) {
  if (!available) {
    return (
      <Group gap={4}>
        <Text size="xs" c="dimmed" fw={600} td="line-through">
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          (not recorded)
        </Text>
      </Group>
    );
  }
  return (
    <Group gap={4}>
      <Box w={10} h={10} style={{ borderRadius: 3, background: color }} />
      <Text size="xs" c={muted ? 'dimmed' : undefined} fw={600} td={muted ? 'line-through' : undefined}>
        {label}
      </Text>
      <ActionIcon
        size="sm"
        variant={muted ? 'filled' : 'subtle'}
        color={muted ? 'gray' : 'blue'}
        onClick={onToggle}
        aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
      >
        {muted ? <IconVolumeOff size={14} /> : <IconVolume size={14} />}
      </ActionIcon>
    </Group>
  );
}
