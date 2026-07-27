import { useEffect, useMemo, useRef } from 'react';
import { ScrollArea, Text } from '@mantine/core';
import { Transcript } from '../api/client';
import { FAR_COLOR, NEAR_COLOR } from './DualChannelWaveform';
import classes from './ConversationTranscript.module.css';

type Segment = { start: number; end: number; text: string };

type Turn = {
  key: string;
  leg: string;
  start: number | null;
  end: number | null;
  text: string;
};

type Props = {
  transcripts: Transcript[];
  nearLabel: string;
  farLabel: string;
  currentTime?: number;
  onSeek?: (time: number) => void;
  maxHeight?: number;
};

const MERGE_GAP_S = 1.0;

function formatTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 10) / 10);
  const m = Math.floor(total / 60);
  const whole = Math.floor(total % 60);
  const tenth = Math.round((total % 1) * 10);
  if (tenth === 0) return `${m}:${whole.toString().padStart(2, '0')}`;
  return `${m}:${whole.toString().padStart(2, '0')}.${tenth}`;
}

function mergeTurns(turns: Turn[]): Turn[] {
  if (turns.length === 0) return turns;
  const sorted = [...turns].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const out: Turn[] = [];
  for (const turn of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.leg === turn.leg &&
      prev.start != null &&
      prev.end != null &&
      turn.start != null &&
      turn.start - prev.end <= MERGE_GAP_S
    ) {
      prev.end = turn.end ?? prev.end;
      prev.text = `${prev.text} ${turn.text}`.replace(/\s+/g, ' ').trim();
      continue;
    }
    out.push({ ...turn });
  }
  return out;
}

export function ConversationTranscript({
  transcripts,
  nearLabel,
  farLabel,
  currentTime = 0,
  onSeek,
  maxHeight = 320,
}: Props) {
  const activeRef = useRef<HTMLDivElement>(null);

  const turns = useMemo<Turn[]>(() => {
    // Per-leg transcripts give speaker attribution; stereo/mix duplicates them.
    const legs = transcripts.filter((t) => t.leg === 'near' || t.leg === 'far');
    const source = legs.length > 0 ? legs : transcripts;

    const out: Turn[] = [];
    for (const t of source) {
      const segments = (t.segments_json as Segment[] | null) ?? [];
      const valid = segments.filter(
        (s) => s && typeof s.start === 'number' && typeof s.text === 'string' && s.text.trim() !== '',
      );
      if (valid.length > 0) {
        valid.forEach((s, i) =>
          out.push({
            key: `${t.id}-${i}`,
            leg: t.leg,
            start: s.start,
            end: typeof s.end === 'number' ? s.end : s.start,
            text: s.text.trim(),
          }),
        );
      } else if (t.text.trim()) {
        out.push({ key: `${t.id}-full`, leg: t.leg, start: null, end: null, text: t.text.trim() });
      }
    }
    return mergeTurns(out);
  }, [transcripts]);

  const dual = useMemo(
    () => turns.some((t) => t.leg === 'near') && turns.some((t) => t.leg === 'far'),
    [turns],
  );

  const activeKey = useMemo(() => {
    const active = turns.find(
      (r) => r.start != null && r.end != null && currentTime >= r.start && currentTime < r.end,
    );
    return active?.key ?? null;
  }, [turns, currentTime]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeKey]);

  if (turns.length === 0) return null;

  const seek = (start: number | null) => {
    if (start != null && onSeek) onSeek(start);
  };

  return (
    <ScrollArea.Autosize mah={maxHeight} type="auto" className={classes.scroll}>
      {dual ? (
        <div
          className={classes.dual}
          style={{ ['--near-color' as string]: NEAR_COLOR, ['--far-color' as string]: FAR_COLOR }}
        >
          <div className={classes.dualHeader}>
            <span />
            <Text className={`${classes.dualHeaderLabel} ${classes.dualHeaderNear}`} title={nearLabel}>
              {nearLabel}
            </Text>
            <Text className={`${classes.dualHeaderLabel} ${classes.dualHeaderFar}`} title={farLabel}>
              {farLabel}
            </Text>
          </div>
          {turns.map((turn) => {
            const active = turn.key === activeKey;
            const isNear = turn.leg === 'near';
            return (
              <div
                key={turn.key}
                ref={active ? activeRef : undefined}
                className={`${classes.dualRow} ${active ? classes.dualRowActive : ''}`}
              >
                <div className={classes.dualTime}>
                  {turn.start != null ? formatTime(turn.start) : '—'}
                </div>
                <div className={classes.emptyCell}>
                  {isNear && (
                    <div
                      className={`${classes.bubble} ${classes.bubbleNear} ${
                        turn.start != null && onSeek ? classes.bubbleClickable : ''
                      }`}
                      onClick={() => seek(turn.start)}
                    >
                      {turn.text}
                    </div>
                  )}
                </div>
                <div className={classes.emptyCell}>
                  {!isNear && (
                    <div
                      className={`${classes.bubble} ${classes.bubbleFar} ${
                        turn.start != null && onSeek ? classes.bubbleClickable : ''
                      }`}
                      onClick={() => seek(turn.start)}
                    >
                      {turn.text}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={classes.mono}>
          {turns.map((turn) => {
            const active = turn.key === activeKey;
            const clickable = turn.start != null && !!onSeek;
            return (
              <div
                key={turn.key}
                ref={active ? activeRef : undefined}
                className={`${classes.monoRow} ${active ? classes.monoRowActive : ''} ${
                  clickable ? classes.monoRowClickable : ''
                }`}
                onClick={() => seek(turn.start)}
              >
                <div className={classes.monoTime}>
                  {turn.start != null ? formatTime(turn.start) : '—'}
                </div>
                <div className={classes.monoText}>{turn.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </ScrollArea.Autosize>
  );
}
