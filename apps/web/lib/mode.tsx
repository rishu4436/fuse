'use client';
// App mode. LIVE (default): BCH mainnet — real chain reads, real execute path (simulate → Guardian → sign in your
// wallet → broadcast → certificate). SANDBOX (explicit opt-in): the local BCH 2026 VM world with simulated coins.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export type Mode = 'live' | 'sandbox';
const Ctx = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: 'live', setMode: () => undefined });
export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>('live');
  useEffect(() => { const q = new URLSearchParams(location.search).get('mode'); const s = (q ?? localStorage.getItem('fuse-mode')) as Mode | null; if (s === 'sandbox' || s === 'live') setModeState(s); }, []);
  const setMode = (m: Mode) => { setModeState(m); localStorage.setItem('fuse-mode', m); };
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>;
}
export const useMode = () => useContext(Ctx);
