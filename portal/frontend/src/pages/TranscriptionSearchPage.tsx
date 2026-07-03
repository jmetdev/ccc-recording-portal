import { useState } from 'react';
import { Button, Card, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { api, TranscriptSearchResult } from '../api/client';
import { useCallPlayer } from '../components/CallPlayerContext';

export function TranscriptionSearchPage() {
  const { openCall } = useCallPlayer();
  const [q, setQ] = useState('');
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [results, setResults] = useState<TranscriptSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setResults(await api.searchTranscripts(q, sentiment || undefined));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="lg">
      <Title order={2}>Transcription Search</Title>
      <Text size="sm" c="dimmed">
        Search indexed transcripts across all calls. Open a call from results to play audio and read the full
        transcription in the player drawer.
      </Text>
      <Card withBorder padding="md">
        <Stack>
          <TextInput label="Keywords" value={q} onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          <Select label="Sentiment" clearable data={['positive', 'neutral', 'negative']} value={sentiment} onChange={setSentiment} />
          <Button onClick={search} loading={loading}>Search</Button>
        </Stack>
      </Card>
      {results.map((r) => (
        <Card key={r.transcript_id} withBorder padding="md">
          <Group justify="space-between" mb="xs">
            <Text size="sm" c="dimmed">
              Call #{r.call_id} · {r.leg}
              {r.sentiment && ` · ${r.sentiment}`}
            </Text>
            <Button size="xs" variant="light" onClick={() => openCall(r.call_id)}>
              Open call
            </Button>
          </Group>
          <Text dangerouslySetInnerHTML={{ __html: r.headline }} />
        </Card>
      ))}
      {!loading && results.length === 0 && q && <Text c="dimmed">No results</Text>}
    </Stack>
  );
}
