import { useState } from 'react';
import { Badge, Button, Card, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { api, TranscriptSearchResult } from '../api/client';
import { useCallPlayer } from '../components/CallPlayerContext';
import { FAR_COLOR, NEAR_COLOR } from '../components/DualChannelWaveform';

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
};

export function SearchPage() {
  const { openCall } = useCallPlayer();
  const [q, setQ] = useState('');
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [results, setResults] = useState<TranscriptSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

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

  return (
    <Stack gap="lg">
      <Title order={2}>Search</Title>
      <Text size="sm" c="dimmed">
        Full-text search across indexed call transcripts. Open a result to play the audio and read the
        full conversation.
      </Text>
      <Card padding="md" radius="md">
        <Stack>
          <TextInput
            label="Keywords"
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
          <Text dangerouslySetInnerHTML={{ __html: r.headline }} />
        </Card>
      ))}
      {!loading && searched && results.length === 0 && <Text c="dimmed">No results.</Text>}
    </Stack>
  );
}
