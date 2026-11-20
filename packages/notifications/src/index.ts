// F22 notifications: in-app store with dedupe + per-key cooldown. Other channels are declared but report
// NOT_CONFIGURED; FUSE never sends external messages without a configured, owner-approved channel.
export type Severity = 'info' | 'warning' | 'critical';
export interface Notification { id: string; at: number; severity: Severity; title: string; body: string; key: string; read: boolean; source: string }
export const CHANNELS = { 'in-app': 'IMPLEMENTED', webhook: 'NOT_CONFIGURED', email: 'NOT_CONFIGURED', telegram: 'NOT_CONFIGURED' } as const;

export class NotificationCenter {
  private items: Notification[] = [];
  private last = new Map<string, number>();
  private seq = 0;
  constructor(private o: { cooldownMs?: number; max?: number; now?: () => number } = {}) {}
  private get now() { return (this.o.now ?? Date.now)(); }
  /** Returns the notification, or null when deduplicated within the cooldown window. */
  push(n: { severity: Severity; title: string; body: string; key: string; source: string }): Notification | null {
    const t = this.now, prev = this.last.get(n.key);
    if (prev !== undefined && t - prev < (this.o.cooldownMs ?? 10 * 60_000)) return null;
    this.last.set(n.key, t);
    const item: Notification = { ...n, id: `ntf_${++this.seq}`, at: t, read: false };
    this.items.unshift(item);
    this.items.length = Math.min(this.items.length, this.o.max ?? 500);
    return item;
  }
  list(f: { unread?: boolean; severity?: Severity } = {}) { return this.items.filter((i) => (!f.unread || !i.read) && (!f.severity || i.severity === f.severity)); }
  markRead(id?: string) { for (const i of this.items) if (!id || i.id === id) i.read = true; }
  get unread() { return this.items.filter((i) => !i.read).length; }
}
