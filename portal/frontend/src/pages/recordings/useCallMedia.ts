import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, recordingHasMedia } from '../../api/client';

export function useCallMedia(callId: number | null) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [playSignal, setPlaySignal] = useState<number | undefined>();
  const [pauseSignal, setPauseSignal] = useState<number | undefined>();

  const call = useQuery({
    queryKey: ['call', callId],
    queryFn: () => api.getCall(callId!),
    enabled: callId != null && Number.isFinite(callId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'recording' || s === 'processing' || s === 'transcribing' ? 3000 : false;
    },
  });

  const recordings = useQuery({
    queryKey: ['recordings', callId],
    queryFn: () => api.getRecordings(callId!),
    enabled: callId != null && Number.isFinite(callId),
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

  const items = recordings.data ?? [];
  const nearRecording = items.find((r) => r.leg === 'near' && recordingHasMedia(r)) ?? null;
  const farRecording = items.find((r) => r.leg === 'far' && recordingHasMedia(r)) ?? null;
  const stereoRecording = items.find((r) => r.leg === 'stereo' && recordingHasMedia(r)) ?? null;
  const mixRecording = items.find((r) => r.leg === 'mix' && recordingHasMedia(r)) ?? null;
  const hasAudio = !!(nearRecording || farRecording || stereoRecording || mixRecording);
  const downloadRecording =
    stereoRecording || mixRecording || farRecording || nearRecording || null;

  const prevCallId = useRef<number | null>(null);
  useEffect(() => {
    if (callId !== prevCallId.current) {
      prevCallId.current = callId;
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setSeekTo(null);
    }
  }, [callId]);

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

  const seek = useCallback((time: number) => {
    setSeekTo(time + Math.random() * 1e-6);
  }, []);

  const durationSeconds = useMemo(
    () => duration || call.data?.duration_s || 0,
    [duration, call.data?.duration_s],
  );

  return {
    call,
    recordings,
    nearRecording,
    farRecording,
    stereoRecording,
    mixRecording,
    hasAudio,
    downloadRecording,
    playing,
    currentTime,
    duration,
    durationSeconds,
    seekTo,
    playSignal,
    pauseSignal,
    setPlaying,
    setCurrentTime,
    setDuration,
    togglePlay,
    onSeek,
    seek,
  };
}
