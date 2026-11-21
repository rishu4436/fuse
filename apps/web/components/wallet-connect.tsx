'use client';
// WizardConnect (hdwalletv1) pairing. FUSE derives the wallet's receive address from the shared xpub. In the live
// execute flow the wallet signs FUSE-composed transactions (broadcast:false); FUSE relays only the signed hex.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import { Button, Badge, Mono } from './ui';
import { MainnetPreflight, type WalletHandle } from './preflight';
import { wizSignPayload } from '@/lib/wiz-wire';

type State = { kind: 'idle' } | { kind: 'pairing'; uri: string; qr: string; relay: string } | { kind: 'connected'; wallet: string; address: string | null; protocol: string | null; handle: WalletHandle | null } | { kind: 'error'; message: string };

export function WalletConnect({ onHandle }: { onHandle?: (h: WalletHandle | null) => void } = {}) {
  const [st, setSt] = useState<State>({ kind: 'idle' });
  const ref = useRef<{ cleanup?: () => void; disconnect?: () => Promise<void> }>({});
  useEffect(() => () => ref.current.cleanup?.(), []);

  const connect = async () => {
    ref.current.cleanup?.();
    onHandle?.(null);
    try {
      const [{ initiateDappRelay }, { DappConnectionManager }, lib] = await Promise.all([import('@wizardconnect/core'), import('@wizardconnect/dapp'), import('@bitauth/libauth')]);
      const mgr = new DappConnectionManager('FUSE Studio', `${location.origin}/icon.svg`, { session: false });
      let relayState = 'connecting';
      const relay = initiateDappRelay(({ client, status }) => { relayState = String(status.status); mgr.updateConnection(client, status); setSt((s) => (s.kind === 'pairing' ? { ...s, relay: relayState } : s)); });
      mgr.attachRelay(relay);
      mgr.on('walletready', () => {
        const pub = mgr.getPubkey(0, 0n);
        const address = pub ? lib.encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: lib.hash160(pub) }).address : null;
        const handle: WalletHandle | null = address ? {
          address,
          sign: async (req, inputPaths) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const res = await Promise.race([mgr.signTransaction({ transaction: wizSignPayload(req) as never, inputPaths }),
              new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Wallet approval timed out. Run preflight again.')), 90_000); })]).finally(() => clearTimeout(timer));
            if (res.error) throw new Error(res.error);
            return res.signedTransaction;
          },
        } : null;
        setSt({ kind: 'connected', wallet: mgr.walletName ?? 'Wallet', address, protocol: mgr.protocol, handle });
        onHandle?.(handle);
      });
      mgr.on('disconnect', (_r, m) => { onHandle?.(null); setSt({ kind: 'error', message: m || 'Wallet disconnected' }); });
      ref.current = { cleanup: () => relay.cleanup(), disconnect: async () => { await mgr.sendDisconnect('FUSE Studio closed the session').catch(() => undefined); relay.cleanup(); } };
      const qr = await QRCode.toDataURL(relay.qrUri, { margin: 1, width: 220, color: { dark: '#e3e9ef', light: '#0b0f15' } });
      setSt({ kind: 'pairing', uri: relay.uri, qr, relay: relayState });
    } catch (e) { setSt({ kind: 'error', message: (e as Error).message }); }
  };
  const disconnect = async () => { await ref.current.disconnect?.(); setSt({ kind: 'idle' }); onHandle?.(null); };

  return (
    <div data-testid="wallet-connect">
      <AnimatePresence mode="wait">
        {st.kind === 'idle' && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="mb-3 text-[12px] leading-relaxed text-fog-400">Pair a BCH wallet over WizardConnect (hdwalletv1). FUSE reads your receive address; in Execute it asks your wallet to sign the composed transaction. Keys never leave your wallet.</p>
            <Button variant="ghost" onClick={connect} data-testid="wc-connect">Connect with WizardConnect</Button>
          </motion.div>
        )}
        {st.kind === 'pairing' && (
          <motion.div key="pair" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
            
            <img src={st.qr} alt="WizardConnect pairing QR code" className="size-[180px] rounded-lg border hairline" data-testid="wc-qr" />
            <div className="text-center text-[11.5px] text-fog-400">Scan with a WizardConnect wallet · relay <span className="text-fog-200">{st.relay}</span></div>
            <div className="flex gap-2">
              <a className="underline" href={st.uri}>Open wallet</a>
              <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(st.uri)}>Copy link</Button>
              <Button variant="quiet" onClick={disconnect}>Cancel</Button>
            </div>
          </motion.div>
        )}
        {st.kind === 'connected' && (
          <motion.div key="conn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2 text-[12.5px]">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-volt-400" />{st.wallet}</span><Badge mode={onHandle ? 'LIVE' : 'READ-ONLY'} /></div>
            <Mono className="break-all text-fog-300">{st.address ?? 'receive path not shared'}</Mono>
            <div className="text-[11px] text-fog-400">protocol {st.protocol ?? '—'} · signing uses SIGHASH_ALL|FORKID|UTXOS</div>
            <Button variant="quiet" onClick={disconnect} className="self-start px-0">Disconnect</Button>
            {st.handle && !onHandle && <MainnetPreflight wallet={st.handle} />}
          </motion.div>
        )}
        {st.kind === 'error' && (
          <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[12px]">
            <div role="alert" className="mb-2 text-rose-bad">{st.message}</div>
            <Button variant="ghost" onClick={() => setSt({ kind: 'idle' })}>Try again</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
