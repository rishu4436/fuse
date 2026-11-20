import Link from 'next/link';
export default function NotFound() {
  return <div className="mx-auto max-w-md py-24 text-center"><div className="num text-[12px] text-volt-400">404</div><h1 className="mt-2 text-[24px] font-semibold">Nothing at this address</h1><p className="mt-2 text-[13px] text-fog-400">No route here.</p><Link href="/" className="mt-6 inline-block text-[13px] text-volt-300">← Back to FUSE</Link></div>;
}
