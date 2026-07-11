import { ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { api, TranscriptSearchResult } from '../api/client';
import { useCallPlayer } from '../components/CallPlayerContext';
import { FAR_COLOR, NEAR_COLOR } from '../components/DualChannelWaveform';

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
};

const EXAMPLE_QUERIES = ['voicemail', 'callback', 'account number', 'transfer'];

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

export function SearchPage() {
  const { openCall } = useCallPlayer();
  const [q, setQ] = useState('');
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [results, setResults] = useState<TranscriptSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const coverage = useQuery({ queryKey: ['transcript-coverage'], queryFn: api.transcriptCoverage });

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setResults(await api.searchTranscripts(q, sentiment || undefined));
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
        Full-text search across indexed call transcripts. Open a result to play the audio and read the
        full conversation. Only calls with a transcript are searchable.
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
          <Select label="Sentiment" clearable data={['positive', 'neutral', 'negative']} value={sentiment} onChange={setSentiment} />
          <Group>
            <Button onClick={search} loading={loading}>
              Search
            </Button>
          </Group>
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
      {results.map((r) => (
        <Card key={r.transcript_id} padding="md" radius="md">
          <Group justify="space-between" mb="xs">
            <Group gap={6}>
              <Text size="sm" c="dimmed" ff="monospace">
                Call #{r.call_id}
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
          <Text>
            <Headline text={r.headline} />
          </Text>
        </Card>
      ))}
      {!loading && searched && results.length === 0 && (
        <Text c="dimmed">
          No results{total === 0 ? ' — no transcripts are indexed yet' : ''}. Try different keywords or clear
          the sentiment filter.
        </Text>
      )}
    </Stack>
  );
}
