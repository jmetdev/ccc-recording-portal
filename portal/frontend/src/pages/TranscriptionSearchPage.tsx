import { useState } from 'react';
import { Button, Card, Select, Stack, Text, TextInput, Title, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { api, TranscriptSearchResult } from '../api/client';

export function TranscriptionSearchPage() {
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
      <Card withBorder padding="md">
        <Stack>
          <TextInput label="Keywords" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <Select label="Sentiment" clearable data={['positive', 'neutral', 'negative']} value={sentiment} onChange={setSentiment} />
          <Button onClick={search} loading={loading}>Search</Button>
        </Stack>
      </Card>
      {results.map((r) => (
        <Card key={r.transcript_id} withBorder padding="md">
          <Text size="sm" c="dimmed">
            Call #{r.call_id} · {r.leg}
            {r.sentiment && ` · ${r.sentiment}`}
          </Text>
          <Text mt="xs" dangerouslySetInnerHTML={{ __html: r.headline }} />
          <Anchor component={Link} to="/calls" mt="sm" size="sm">Open Call Search</Anchor>
        </Card>
      ))}
      {!loading && results.length === 0 && q && <Text c="dimmed">No results</Text>}
    </Stack>
  );
}
