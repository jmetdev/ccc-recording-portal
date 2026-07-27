import { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { api, TranscriptSearchResult } from '../api/client';
import { useCallPlayer } from '../components/CallPlayerContext';
import { FAR_COLOR, NEAR_COLOR } from '../components/DualChannelWaveform';
import { formatParty } from '../utils/partyLabel';

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
};

const EXAMPLE_QUERIES = ['voicemail', 'callback', 'account number', 'transfer'];

const TIME_FRAMES = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
] as const;

type TimeFrame = (typeof TIME_FRAMES)[number]['value'];

/** ts_headline wraps matches in <b>…</b>; render those spans without ever
 * interpreting the transcript text itself as markup. */
function Headline({ text }: { text: string }) {
  const parts = text.split(/(<b>|<\/b>)/g);
  let bold = false;
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part === '<b>') {
      bold = true;
      return;
    }
    if (part === '</b>') {
      bold = false;
      return;
    }
    if (!part) return;
    nodes.push(bold ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>);
  });
  return <>{nodes}</>;
}

function shortDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateInput(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  return (endOfDay ? endOfLocalDay(date) : startOfLocalDay(date)).toISOString();
}

function rangeForPreset(preset: TimeFrame): { from?: string; to?: string } {
  const now = new Date();
  if (preset === 'any' || preset === 'custom') return {};
  if (preset === 'today') {
    return { from: startOfLocalDay(now).toISOString(), to: now.toISOString() };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: now.toISOString() };
}

export function SearchPage() {
  const { openCall } = useCallPlayer();
  const [q, setQ] = useState('');
  const [near, setNear] = useState('');
  const [far, setFar] = useState('');
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('30d');
  const [customFrom, setCustomFrom] = useState(() =>
    toDateInputValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  );
  const [customTo, setCustomTo] = useState(() => toDateInputValue(new Date()));
  const [results, setResults] = useState<TranscriptSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coverage = useQuery({ queryKey: ['transcript-coverage'], queryFn: api.transcriptCoverage });

  const dateRange = useMemo(() => {
    if (timeFrame === 'custom') {
      return {
        from: parseDateInput(customFrom, false),
        to: parseDateInput(customTo, true),
      };
    }
    return rangeForPreset(timeFrame);
  }, [timeFrame, customFrom, customTo]);

  const canSearch =
    q.trim().length >= 2 ||
    near.trim().length > 0 ||
    far.trim().length > 0 ||
    Boolean(sentiment) ||
    Boolean(dateRange.from || dateRange.to);

  const search = async () => {
    if (!canSearch) {
      setError('Enter keywords (2+ characters) and/or near, far, sentiment, or a time range.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResults(
        await api.searchTranscripts({
          q: q.trim().length >= 2 ? q.trim() : undefined,
          sentiment: sentiment || undefined,
          near: near.trim() || undefined,
          far: far.trim() || undefined,
          date_from: dateRange.from,
          date_to: dateRange.to,
        }),
      );
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const total = coverage.data?.total_calls ?? 0;
  const transcribed = coverage.data?.transcribed_calls ?? 0;
  const coveragePct = total > 0 ? Math.round((transcribed / total) * 100) : null;

  return (
    <Stack gap="lg">
      <Title order={2}>Search</Title>
      <Text size="sm" c="dimmed">
        Full-text search across indexed call transcripts. Filter by time range and near/far
        (calling/called) parties. Open a result to play the audio and read the full conversation.
      </Text>
      {coverage.isSuccess && (
        <Alert
          variant="light"
          color={coveragePct === null ? 'gray' : coveragePct >= 90 ? 'teal' : coveragePct > 0 ? 'yellow' : 'red'}
          icon={<IconInfoCircle size={16} />}
        >
          {total === 0
            ? 'No completed calls have transcripts indexed yet — search will not return results.'
            : `${transcribed} of ${total} completed calls (${coveragePct}%) have a transcript indexed.`}
        </Alert>
      )}
      <Card padding="md" radius="md">
        <Stack>
          <TextInput
            label="Keywords"
            placeholder={`e.g. "${EXAMPLE_QUERIES[0]}"`}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput
              label="Near (calling)"
              description="Recorded extension / local party"
              placeholder="Name or number"
              value={near}
              onChange={(e) => setNear(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            <TextInput
              label="Far (called)"
              description="Remote / other party"
              placeholder="Name or number"
              value={far}
              onChange={(e) => setFar(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Select
              label="Time frame"
              data={[...TIME_FRAMES]}
              value={timeFrame}
              onChange={(v) => setTimeFrame((v as TimeFrame) || 'any')}
              allowDeselect={false}
            />
            <Select
              label="Sentiment"
              clearable
              data={['positive', 'neutral', 'negative']}
              value={sentiment}
              onChange={setSentiment}
            />
          </SimpleGrid>
          {timeFrame === 'custom' && (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput
                type="date"
                label="From"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.currentTarget.value)}
              />
              <TextInput
                type="date"
                label="To"
                value={customTo}
                onChange={(e) => setCustomTo(e.currentTarget.value)}
              />
            </SimpleGrid>
          )}
          <Group>
            <Button onClick={search} loading={loading} disabled={!canSearch && !loading}>
              Search
            </Button>
          </Group>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Card>
      {!searched && (
        <Text size="sm" c="dimmed">
          Try{' '}
          {EXAMPLE_QUERIES.map((ex, i) => (
            <span key={ex}>
              {i > 0 && ', '}
              <Text
                component="span"
                c="brandBlue.6"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setQ(ex);
                }}
              >
                “{ex}”
              </Text>
            </span>
          ))}
          .
        </Text>
      )}
      {results.map((r) => {
        const title = formatParty(r.far_name, r.far_addr);
        const nearLabel = formatParty(r.near_name, r.near_addr);
        const dateLabel = r.started_at ? shortDate(r.started_at) : null;
        return (
          <Card key={r.transcript_id} padding="md" radius="md">
            <Group justify="space-between" mb="xs">
              <Group gap={6}>
                <Text size="sm" fw={600}>
                  {title}
                </Text>
                <Badge
                  size="xs"
                  variant="light"
                  color="gray"
                  style={{ color: r.leg === 'near' ? NEAR_COLOR : r.leg === 'far' ? FAR_COLOR : undefined }}
                >
                  {r.leg} leg
                </Badge>
                {r.sentiment && (
                  <Badge size="xs" variant="light" color={SENTIMENT_COLORS[r.sentiment] ?? 'gray'}>
                    {r.sentiment}
                  </Badge>
                )}
              </Group>
              <Button size="xs" variant="light" onClick={() => openCall(r.call_id)}>
                Open recording
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mb={6}>
              Near: {nearLabel} · Far: {formatParty(r.far_name, r.far_addr)}
              {dateLabel ? ` · ${dateLabel}` : ''}
            </Text>
            <Text>
              <Headline text={r.headline} />
            </Text>
          </Card>
        );
      })}
      {!loading && searched && results.length === 0 && !error && (
        <Text c="dimmed">
          No results{total === 0 ? ' — no transcripts are indexed yet' : ''}. Try different keywords or
          broaden the filters.
        </Text>
      )}
    </Stack>
  );
}
