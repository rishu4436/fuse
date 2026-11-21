// Reproducibly compile all FUSE CashScript contracts with the pinned cashc version.
import { compileFile } from 'cashc';
import { writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });
const manifest: Record<string, { bytecodeSha256: string; opcodes: number; compiler: string }> = {};
for (const file of readdirSync(join(root, 'contracts')).filter((f) => f.endsWith('.cash'))) {
  const artifact = compileFile(new URL(`../contracts/${file}`, import.meta.url));
  artifact.source = artifact.source.replace(/\r\n/g, '\n');
  // updatedAt is the only non-deterministic field; pin it so artifacts are byte-reproducible.
  (artifact as { updatedAt: string }).updatedAt = '1970-01-01T00:00:00.000Z';
  writeFileSync(join(outDir, `${artifact.contractName}.json`), JSON.stringify(artifact, null, 2) + '\n');
  manifest[artifact.contractName] = {
    bytecodeSha256: createHash('sha256').update(artifact.bytecode).digest('hex'),
    opcodes: artifact.bytecode.split(' ').length,
    compiler: `${artifact.compiler.name}@${artifact.compiler.version}`,
  };
  console.log(`compiled ${file} -> ${artifact.contractName} (${manifest[artifact.contractName].opcodes} ops)`);
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
