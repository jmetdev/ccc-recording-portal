import { useEffect, useMemo, useRef, useState } from 'react';
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

const MERGE_GAP_S = 0.35;
/** Prefer near before far when timestamps collide (agent typically speaks first). */
const LEG_ORDER: Record<string, number> = { near: 0, far: 1, stereo: 2, mix: 3 };

function formatTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 10) / 10);
  const m = Math.floor(total / 60);
  const whole = Math.floor(total % 60);
  const tenth = Math.round((total % 1) * 10);
  if (tenth === 0) return `${m}:${whole.toString().padStart(2, '0')}`;
  return `${m}:${whole.toString().padStart(2, '0')}.${tenth}`;
}

function legRank(leg: string): number {
  return LEG_ORDER[leg] ?? 9;
}

/** True when another speaker has speech overlapping the gap between two turns. */
function otherLegSpokeInGap(turns: Turn[], leg: string, gapStart: number, gapEnd: number): boolean {
  if (gapEnd <= gapStart) return false;
  return turns.some(
    (t) =>
      t.leg !== leg &&
      t.start != null &&
      t.end != null &&
      t.start < gapEnd &&
      t.end > gapStart,
  );
}

/**
 * Only merge tiny same-leg splits (Whisper chopping mid-sentence).
 * Do not merge across listening gaps — silence on one leg is usually the
 * other party talking, and combining those bubbles wrecks the timeline.
 */
function mergeTurns(turns: Turn[]): Turn[] {
  if (turns.length === 0) return turns;
  const sorted = [...turns].sort(
    (a, b) =>
      (a.start ?? 0) - (b.start ?? 0) ||
      legRank(a.leg) - legRank(b.leg) ||
      a.leg.localeCompare(b.leg),
  );
  const out: Turn[] = [];
  for (const turn of sorted) {
    const prev = out[out.length - 1];
    const canMerge =
      !!prev &&
      prev.leg === turn.leg &&
      prev.start != null &&
      prev.end != null &&
      turn.start != null &&
      turn.start - prev.end <= MERGE_GAP_S &&
      !otherLegSpokeInGap(sorted, turn.leg, prev.end, turn.start);
    if (canMerge) {
      prev!.end = turn.end ?? prev!.end;
      prev!.text = `${prev!.text} ${turn.text}`.replace(/\s+/g, ' ').trim();
      continue;
    }
    out.push({ ...turn });
  }
  return out;
}

function turnContains(turn: Turn, time: number): boolean {
  return turn.start != null && turn.end != null && time >= turn.start && time < turn.end;
}

/**
 * When Whisper stamps overlapping near/far ranges (common when both start at 0),
 * prefer the shortest matching span so a long agent bubble does not steal the
 * highlight from a shorter caller utterance.
 */
function pickActiveTurn(turns: Turn[], currentTime: number, pinnedKey: string | null): Turn | null {
  if (pinnedKey) {
    const pinned = turns.find((t) => t.key === pinnedKey);
    if (pinned && turnContains(pinned, currentTime)) return pinned;
  }

  const matches = turns.filter((t) => turnContains(t, currentTime));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return [...matches].sort(
      (a, b) =>
        a.end! - a.start! - (b.end! - b.start!) ||
        legRank(a.leg) - legRank(b.leg),
    )[0];
  }

  // In gaps between utterances, keep the most recently started turn visible
  // so follow-along does not flicker to "nothing".
  let best: Turn | null = null;
  for (const t of turns) {
    if (t.start == null || t.start > currentTime) continue;
    if (
      !best ||
      t.start > (best.start ?? -1) ||
      (t.start === best.start && legRank(t.leg) < legRank(best.leg))
    ) {
      best = t;
    }
  }
  return best;
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
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);

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

  const activeTurn = useMemo(
    () => pickActiveTurn(turns, currentTime, pinnedKey),
    [turns, currentTime, pinnedKey],
  );
  const activeKey = activeTurn?.key ?? null;

  useEffect(() => {
    if (pinnedKey && activeKey !== pinnedKey) setPinnedKey(null);
  }, [activeKey, pinnedKey]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeKey]);

  if (turns.length === 0) return null;

  const seek = (turn: Turn) => {
    if (turn.start == null || !onSeek) return;
    setPinnedKey(turn.key);
    // Nudge slightly into the span so an exclusive end-boundary on another
    // overlapping turn does not keep the previous bubble highlighted.
    onSeek(turn.start + 0.05);
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
                      onClick={() => seek(turn)}
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
                      onClick={() => seek(turn)}
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
                onClick={() => seek(turn)}
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
