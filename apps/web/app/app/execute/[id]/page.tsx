'use client';
import { use } from 'react';
import Link from 'next/link';
import { AuctionView } from '@/components/auction-view';
export default function AuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <div className="mx-auto max-w-6xl"><Link href="/app/execute" className="mb-5 inline-block text-[12.5px] text-fog-400 hover:text-fog-100">← All auctions</Link><AuctionView id={id} /></div>;
}
