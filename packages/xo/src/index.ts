// F48 — XO Stack integration, limited to what the published XO packages support offline:
//   * validate templates with @xo-cash/utils `parseTemplate` and derive their content identifier
//     (`generateTemplateIdentifier`), so FUSE can pin exactly which XO templates it trusts;
//   * compile a template's locking script with the XO CashAssembly compiler (`compileCashAssemblyString`) from a
//     PUBLIC key, so an XO wallet's P2PKH receive script can be the owner/payout of a FUSE intent.
// The XO Engine (@xo-cash/engine@next: accounts, invitations, broadcasting) needs a live Electrum connection; from
// this build box Electrum ports are not reachable, so engine sessions are BLOCKED here (see XO_ENGINE_STATUS).
// FUSE never asks for a mnemonic or private key: payouts are derived from public keys only.
import { faucetCashTemplate, multisigTemplate, p2pkhTemplate, wrapBCHChipnetTemplate, wrapBCHTemplate } from '@xo-cash/templates';
import { compileCashAssemblyString, generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import { binToHex, cashAssemblyToBin, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';

export const XO_ENGINE_STATUS = {
  status: 'BLOCKED' as const,
  reason: 'XO Engine.create opens Electrum (wss :50004) to chipnet.imaginary.cash / chipnet.bch.ninja; this build box egress proxy only passes HTTP(S) on standard ports, so the TLS handshake is cut (observed "WebSocket: 1006" and "unexpected eof"). Engine integration (invitations, executeAction) is not claimed.',
  verifiedPackages: ['@xo-cash/utils', '@xo-cash/templates'],
};

export interface TemplateInfo { key: string; name: string; description: string; templateIdentifier: string; actions: string[]; roles: string[]; supported: string[] }
const OFFICIAL = { p2pkh: p2pkhTemplate, multisig: multisigTemplate, wrapBCH: wrapBCHTemplate, wrapBCHChipnet: wrapBCHChipnetTemplate, faucetCash: faucetCashTemplate } as const;

/** Validate any XO template (object or JSON). Throws the XO TemplateInvalidError on a malformed template. */
export function inspectTemplate(input: unknown, key = 'custom'): TemplateInfo {
  const t = parseTemplate(input as Parameters<typeof parseTemplate>[0]);
  return { key, name: t.name, description: t.description ?? '', templateIdentifier: generateTemplateIdentifier(t), actions: Object.keys(t.actions ?? {}), roles: Object.keys(t.roles ?? {}), supported: [...(t.supported ?? [])] };
}
export const officialTemplates = (): TemplateInfo[] => Object.entries(OFFICIAL).map(([k, t]) => inspectTemplate(t, k));

/** The XO P2PKH template's receiving locking script, compiled by the XO compiler from a public key. */
export function xoP2pkhPayout(publicKeyHex: string, network: 'mainnet' | 'chipnet' = 'chipnet') {
  if (!/^0[23][0-9a-f]{64}$/.test(publicKeyHex)) throw new Error('expected a 33-byte compressed public key (hex)');
  const t = parseTemplate(p2pkhTemplate);
  const scriptId = t.lockingScripts?.receivingLockingScript?.lockingBytecode as string;
  const src = (t.scripts as Record<string, string>)[scriptId];
  // The template derives the public key from the owner's private key; FUSE substitutes the public key directly.
  const text = compileCashAssemblyString({ cashAssemblyText: src.replace('ownerKey.public_key', 'ownerPublicKey'), variables: { ownerPublicKey: hexToBin(publicKeyHex) }, evaluationDecodeMode: 'hex' });
  const bin = cashAssemblyToBin(text.replace(/<([0-9a-f]+)>/g, '<0x$1>'));
  if (typeof bin === 'string') throw new Error(bin);
  const addr = lockingBytecodeToCashAddress({ bytecode: bin, prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest' });
  return { templateIdentifier: generateTemplateIdentifier(t), lockingScript: 'receivingLockingScript', script: scriptId, compiledText: text, lockingBytecode: binToHex(bin), address: typeof addr === 'string' ? null : addr.address };
}
