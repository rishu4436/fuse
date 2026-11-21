import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { AppShell } from '@/components/shell';
import { ModeProvider } from '@/lib/mode';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'FUSE: live DeFi execution on Bitcoin Cash', template: '%s · FUSE' },
  description: 'Live BCH DeFi execution platform with an integrated simulation and risk-analysis engine: FlashVault flash liquidity, Cauldron routing, Guardian risk checks, wallet signing, broadcast and verifiable certificates on BCH mainnet.',
};
export const viewport: Viewport = { themeColor: '#05070a', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">{process.env.NEXT_PUBLIC_FIXTURE_REPLAY === '1' && <aside role="status" className="bg-amber-200 p-2 text-center text-black">CI fixture replay · recorded BCH data · offline test only</aside>}<ModeProvider><AppShell>{children}</AppShell></ModeProvider></body>
    </html>
  );
}
