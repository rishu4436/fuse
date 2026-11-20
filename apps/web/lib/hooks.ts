'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fromJson } from './api';
import type { FuseEvent } from './types';

export function usePoll<T>(path: string | null, intervalMs = 1500) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try { const d = await api<T>(path); if (alive.current) { setData(d); setError(undefined); } }
    catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setLoading(false); }
  }, [path]);
  useEffect(() => {
    alive.current = true; load();
    const t = intervalMs > 0 ? setInterval(load, intervalMs) : undefined;
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, intervalMs]);
  return { data, error, loading, reload: load };
}

export function useEvents(limit = 60) {
  const [events, setEvents] = useState<FuseEvent[]>([]);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let es: EventSource | undefined; let poll: ReturnType<typeof setInterval> | undefined;
    const add = (e: FuseEvent) => setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [e, ...prev].slice(0, limit)));
    try {
      es = new EventSource('/api/events');
      es.onopen = () => setLive(true);
      es.onmessage = (m) => add(fromJson<FuseEvent>(m.data));
      es.onerror = () => { setLive(false); es?.close(); poll = setInterval(async () => { try { const r = await api<FuseEvent[]>('/api/events/recent'); r.forEach(add); } catch { /* api offline */ } }, 2000); };
    } catch { /* no EventSource */ }
    return () => { es?.close(); if (poll) clearInterval(poll); };
  }, [limit]);
  return { events, live };
}
