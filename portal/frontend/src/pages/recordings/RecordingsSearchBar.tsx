import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Badge, Group, Text, TextInput } from '@mantine/core';
import { IconSearch, IconX } from '@tabler/icons-react';
import type { Call, Group as GroupType } from '../../api/client';
import classes from './RecordingsSearchBar.module.css';

export type RecordingsFilters = {
  q: string;
  source: string | null;
  sentiment: string | null;
  groupId: string | null;
  status: string | null;
};

type SearchKey = 'source' | 'sentiment' | 'group' | 'status';

type KeyDef = {
  key: SearchKey;
  label: string;
  values: { value: string; label: string }[];
};

const SOURCE_VALUES = [
  { value: 'cucm', label: 'CUCM' },
  { value: 'webex', label: 'Webex' },
];

const SENTIMENT_VALUES = [
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
];

const STATUS_VALUES = [
  { value: 'recording', label: 'Recording' },
  { value: 'processing', label: 'Processing' },
  { value: 'transcribing', label: 'Transcribing' },
  { value: 'completed', label: 'Complete' },
  { value: 'failed', label: 'Failed' },
];

type Props = {
  filters: RecordingsFilters;
  onChange: (filters: RecordingsFilters) => void;
  groups?: GroupType[];
  canFilterByGroup?: boolean;
  facetItems?: Call[];
};

function countFacet(items: Call[], key: SearchKey, value: string): number {
  return items.filter((c) => {
    if (key === 'source') return c.source === value;
    if (key === 'sentiment') return c.sentiment === value;
    if (key === 'status') return c.status === value;
    if (key === 'group') return String(c.group_id ?? '') === value;
    return false;
  }).length;
}

function activeTokens(filters: RecordingsFilters, groups: GroupType[]): { key: SearchKey; value: string; label: string }[] {
  const tokens: { key: SearchKey; value: string; label: string }[] = [];
  if (filters.source) {
    tokens.push({
      key: 'source',
      value: filters.source,
      label: SOURCE_VALUES.find((v) => v.value === filters.source)?.label ?? filters.source,
    });
  }
  if (filters.sentiment) {
    tokens.push({
      key: 'sentiment',
      value: filters.sentiment,
      label: SENTIMENT_VALUES.find((v) => v.value === filters.sentiment)?.label ?? filters.sentiment,
    });
  }
  if (filters.status) {
    tokens.push({
      key: 'status',
      value: filters.status,
      label: STATUS_VALUES.find((v) => v.value === filters.status)?.label ?? filters.status,
    });
  }
  if (filters.groupId) {
    const g = groups.find((x) => String(x.id) === filters.groupId);
    tokens.push({
      key: 'group',
      value: filters.groupId,
      label: g?.name ?? `Group ${filters.groupId}`,
    });
  }
  return tokens;
}

export function RecordingsSearchBar({
  filters,
  onChange,
  groups = [],
  canFilterByGroup = false,
  facetItems = [],
}: Props) {
  const [input, setInput] = useState(filters.q);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<SearchKey | null>(null);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInput(filters.q);
  }, [filters.q]);

  const keyDefs = useMemo<KeyDef[]>(() => {
    const defs: KeyDef[] = [
      { key: 'source', label: 'Source', values: SOURCE_VALUES },
      { key: 'sentiment', label: 'Sentiment', values: SENTIMENT_VALUES },
      { key: 'status', label: 'Status', values: STATUS_VALUES },
    ];
    if (canFilterByGroup && groups.length > 0) {
      defs.push({
        key: 'group',
        label: 'Group',
        values: groups.map((g) => ({ value: String(g.id), label: g.name })),
      });
    }
    return defs;
  }, [canFilterByGroup, groups]);

  const tokens = useMemo(() => activeTokens(filters, groups), [filters, groups]);

  const colonMatch = input.match(/(^|\s)(\w+):(\S*)$/);
  const pendingKey = colonMatch?.[2]?.toLowerCase() as SearchKey | undefined;
  const pendingValuePrefix = colonMatch?.[3] ?? '';

  const matchedKeyDef = pendingKey ? keyDefs.find((k) => k.key === pendingKey) : null;

  const filteredValues = useMemo(() => {
    if (!matchedKeyDef) return [];
    const prefix = pendingValuePrefix.toLowerCase();
    return matchedKeyDef.values.filter(
      (v) => !prefix || v.label.toLowerCase().includes(prefix) || v.value.toLowerCase().includes(prefix),
    );
  }, [matchedKeyDef, pendingValuePrefix]);

  const showKeyList = dropdownOpen && !matchedKeyDef && !activeKey;
  const showValueList = dropdownOpen && (!!matchedKeyDef || !!activeKey);

  const currentKeyDef = activeKey ? keyDefs.find((k) => k.key === activeKey) : matchedKeyDef;
  const valueOptions = activeKey
    ? (keyDefs.find((k) => k.key === activeKey)?.values ?? []).filter((v) => {
        const prefix = pendingValuePrefix.toLowerCase();
        return !prefix || v.label.toLowerCase().includes(prefix) || v.value.toLowerCase().includes(prefix);
      })
    : filteredValues;

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    setActiveKey(null);
    setHighlight(0);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeDropdown();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [closeDropdown]);

  const applyFilter = (key: SearchKey, value: string) => {
    const next = { ...filters, q: input.replace(/(^|\s)\w+:\S*$/, '').trim() };
    if (key === 'source') next.source = value;
    if (key === 'sentiment') next.sentiment = value;
    if (key === 'status') next.status = value;
    if (key === 'group') next.groupId = value;
    onChange(next);
    setInput(next.q);
    closeDropdown();
  };

  const removeToken = (key: SearchKey) => {
    const next = { ...filters };
    if (key === 'source') next.source = null;
    if (key === 'sentiment') next.sentiment = null;
    if (key === 'status') next.status = null;
    if (key === 'group') next.groupId = null;
    onChange(next);
  };

  const commitFreeText = () => {
    onChange({ ...filters, q: input.trim() });
    closeDropdown();
  };

  const onInputChange = (value: string) => {
    setInput(value);
    setDropdownOpen(true);
    setHighlight(0);
    if (value.match(/(^|\s)(\w+):/)) {
      const key = value.match(/(^|\s)(\w+):/)?.[2]?.toLowerCase() as SearchKey | undefined;
      setActiveKey(key && keyDefs.some((k) => k.key === key) ? key : null);
    } else {
      setActiveKey(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showValueList && valueOptions[highlight]) {
        const key = activeKey ?? matchedKeyDef?.key;
        if (key) applyFilter(key, valueOptions[highlight].value);
      } else if (showKeyList && keyDefs[highlight]) {
        setActiveKey(keyDefs[highlight].key);
        setHighlight(0);
        const base = input.replace(/(^|\s)\w*:?\S*$/, '').trimEnd();
        setInput(base ? `${base} ${keyDefs[highlight].key}:` : `${keyDefs[highlight].key}:`);
      } else {
        commitFreeText();
      }
      return;
    }
    if (e.key === 'Escape') {
      closeDropdown();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const len = showValueList ? valueOptions.length : keyDefs.length;
      if (!len) return;
      setHighlight((h) => (e.key === 'ArrowDown' ? (h + 1) % len : (h - 1 + len) % len));
    }
    if (e.key === 'Backspace' && !input && tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      removeToken(last.key);
    }
  };

  return (
    <div className={classes.wrap} ref={wrapRef}>
      <div className={classes.bar}>
        <IconSearch size={16} className={classes.searchIcon} />
        <Group gap={6} wrap="wrap" className={classes.tokenRow}>
          {tokens.map((t) => (
            <Badge
              key={`${t.key}-${t.value}`}
              size="sm"
              radius="sm"
              variant="light"
              color="brandBlue"
              className={classes.token}
              rightSection={
                <button
                  type="button"
                  className={classes.tokenRemove}
                  onClick={() => removeToken(t.key)}
                  aria-label={`Remove ${t.key} filter`}
                >
                  <IconX size={12} />
                </button>
              }
            >
              {t.key}:{t.label}
            </Badge>
          ))}
          <TextInput
            className={classes.input}
            variant="unstyled"
            placeholder={tokens.length ? 'Add filter or search…' : 'Search or filter (e.g. source:cucm)…'}
            value={input}
            onChange={(e) => onInputChange(e.currentTarget.value)}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              window.setTimeout(() => {
                if (!wrapRef.current?.contains(document.activeElement)) commitFreeText();
              }, 120);
            }}
          />
        </Group>
      </div>

      {dropdownOpen && (showKeyList || showValueList) && (
        <div className={classes.dropdown} role="listbox">
          {showKeyList &&
            keyDefs.map((k, i) => (
              <button
                key={k.key}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`${classes.option}${i === highlight ? ` ${classes.optionActive}` : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setActiveKey(k.key);
                  const base = input.replace(/(^|\s)\w*:?\S*$/, '').trimEnd();
                  setInput(base ? `${base} ${k.key}:` : `${k.key}:`);
                  setHighlight(0);
                }}
              >
                <Text size="sm" fw={500}>
                  {k.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {k.key}:
                </Text>
              </button>
            ))}

          {showValueList &&
            currentKeyDef &&
            valueOptions.map((v, i) => {
              const count = facetItems.length ? countFacet(facetItems, currentKeyDef.key, v.value) : null;
              return (
                <button
                  key={v.value}
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`${classes.option}${i === highlight ? ` ${classes.optionActive}` : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFilter(currentKeyDef.key, v.value)}
                >
                  <Text size="sm" fw={500}>
                    {v.label}
                  </Text>
                  {count != null && (
                    <Text size="xs" c="dimmed">
                      {count}
                    </Text>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
