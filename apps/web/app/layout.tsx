import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { AppShell } from '@/components/shell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'FUSE: intent execution for Bitcoin Cash', template: '%s · FUSE' },
  description: 'Intent auctions, FlashVault liquidity and verifiable execution certificates on Bitcoin Cash. Demo runs on a local BCH VM; mainnet data is read only.',
};
export const viewport: Viewport = { themeColor: '#05070a', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans"><AppShell>{children}</AppShell></body>
    </html>
  );
}
