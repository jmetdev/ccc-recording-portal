import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Group, Stack, TagsInput, Text, TextInput, Title } from '@mantine/core';
import { api } from '../../api/client';

export function TranscriptionTab() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['tenant-transcription'],
    queryFn: api.tenant.getTranscription,
  });
  const [organizationName, setOrganizationName] = useState('');
  const [hotwords, setHotwords] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings.data || dirty) return;
    setOrganizationName(settings.data.organization_name || '');
    setHotwords(settings.data.hotwords || []);
  }, [settings.data, dirty]);

  const save = useMutation({
    mutationFn: () =>
      api.tenant.updateTranscription({
        organization_name: organizationName,
        hotwords,
      }),
    onSuccess: (data) => {
      setOrganizationName(data.organization_name || '');
      setHotwords(data.hotwords || []);
      setDirty(false);
      qc.setQueryData(['tenant-transcription'], data);
    },
  });

  return (
    <Stack gap="md">
      <div>
        <Title order={3}>Transcription</Title>
        <Text size="sm" c="dimmed" mt={4}>
          These hints are pushed to on-prem Whisper over the connector heartbeat (usually within a
          minute) and applied to new transcriptions.
        </Text>
      </div>
      <Card padding="lg" radius="md" withBorder>
        <Stack gap="sm">
          <TextInput
            label="Organization Name"
            description="Used as Whisper’s initial prompt so names and terms are recognized more reliably"
            placeholder="Kyrene School District"
            value={organizationName}
            onChange={(e) => {
              setOrganizationName(e.currentTarget.value);
              setDirty(true);
            }}
          />
          <TagsInput
            label="Hotwords"
            description="Press Enter to add. Common names, places, and product terms Whisper should prefer."
            placeholder="Add a hotword"
            value={hotwords}
            onChange={(value) => {
              setHotwords(value);
              setDirty(true);
            }}
            clearable
          />
          <Group justify="flex-end">
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!dirty && !save.isPending}
            >
              Save transcription settings
            </Button>
          </Group>
          {save.isSuccess && !dirty && (
            <Text size="xs" c="green">
              Saved — connectors pick this up on the next heartbeat.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
