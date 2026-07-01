import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type CallPlayerContextValue = {
  callId: number | null;
  openCall: (id: number) => void;
  closeCall: () => void;
};

const CallPlayerContext = createContext<CallPlayerContextValue | null>(null);

export function CallPlayerProvider({ children }: { children: ReactNode }) {
  const [callId, setCallId] = useState<number | null>(null);

  const openCall = useCallback((id: number) => setCallId(id), []);
  const closeCall = useCallback(() => setCallId(null), []);

  const value = useMemo(() => ({ callId, openCall, closeCall }), [callId, openCall, closeCall]);

  return <CallPlayerContext.Provider value={value}>{children}</CallPlayerContext.Provider>;
}

export function useCallPlayer() {
  const ctx = useContext(CallPlayerContext);
  if (!ctx) throw new Error('useCallPlayer must be used within CallPlayerProvider');
  return ctx;
}
