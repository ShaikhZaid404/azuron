import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { StreamEvent } from '@azuron/contract';

export interface ActiveRun {
  id: string;
  kind: 'chat' | 'task' | 'terminal';
  title: string;
  step: string;
  startedAt: number;
}

interface StreamHubContextValue {
  connected: boolean;
  lastEventId: number;
  activeRuns: ActiveRun[];
  recentEvents: StreamEvent[];
  subscribe: (listener: (ev: StreamEvent) => void) => () => void;
}

const StreamHubContext = createContext<StreamHubContextValue | null>(null);

export const AzuronStreamHubProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connected, setConnected] = useState(false);
  const [lastEventId, setLastEventId] = useState(0);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [recentEvents, setRecentEvents] = useState<StreamEvent[]>([]);
  const listenersRef = useRef(new Set<(ev: StreamEvent) => void>());
  const lastIdRef = useRef(0);

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const url = lastIdRef.current > 0 ? `/api/stream?lastEventId=${lastIdRef.current}` : '/api/stream';
      source = new EventSource(url);

      source.addEventListener('hub.connected', (e) => {
        setConnected(true);
        try {
          const data = JSON.parse((e as MessageEvent).data) as { activeRuns?: ActiveRun[] };
          if (data.activeRuns) setActiveRuns(data.activeRuns);
        } catch {
          // ignore
        }
      });

      const eventTypes = [
        'chat.delta',
        'chat.tool_call',
        'chat.tool_result',
        'chat.fallback_notice',
        'chat.turn_end',
        'chat.error',
        'task.status',
        'task.log',
        'terminal.output',
        'terminal.exit',
        'system.log',
      ];

      for (const evType of eventTypes) {
        source.addEventListener(evType, (e) => {
          try {
            const ev = JSON.parse((e as MessageEvent).data) as StreamEvent;
            if (ev.id > lastIdRef.current) {
              lastIdRef.current = ev.id;
              setLastEventId(ev.id);
            }
            setRecentEvents((prev) => [...prev.slice(-199), ev]);
            for (const fn of listenersRef.current) {
              fn(ev);
            }
          } catch {
            // ignore malformed event
          }
        });
      }

      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 2500);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const subscribe = (listener: (ev: StreamEvent) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  };

  return (
    <StreamHubContext.Provider
      value={{ connected, lastEventId, activeRuns, recentEvents, subscribe }}
    >
      {children}
    </StreamHubContext.Provider>
  );
};

export function useStreamHub(): StreamHubContextValue {
  const ctx = useContext(StreamHubContext);
  if (!ctx) {
    throw new Error('useStreamHub must be used inside AzuronStreamHubProvider');
  }
  return ctx;
}
