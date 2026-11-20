'use client';
import { useState } from 'react';
export function Code({ children, lang = 'ts' }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="scrollbar-thin overflow-x-auto rounded-xl border hairline bg-ink-950 p-4 text-[12px] leading-relaxed text-fog-200" data-lang={lang}><code>{children}</code></pre>
      <button onClick={() => { navigator.clipboard?.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="absolute right-2 top-2 rounded-md border hairline bg-ink-800 px-2 py-0.5 text-[10.5px] text-fog-300 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
