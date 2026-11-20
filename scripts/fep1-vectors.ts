import { writeFileSync } from 'node:fs';
import { fep1Vectors } from '@fuse/policy-engine';
writeFileSync('docs/standards/fep-1-vectors.json', JSON.stringify(fep1Vectors(), null, 2) + '\n');
console.log('wrote docs/standards/fep-1-vectors.json');
