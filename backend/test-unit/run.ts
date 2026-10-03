/* Zero-dependency unit runner: node:assert + ts-node (no jest/vitest).
 * Run: npm run test:unit  (from backend/) */
import { testImages } from './images.test';
import { testNet } from './net.test';
import { testUuidPipe } from './uuid.test';
import { testWsTicket } from './ws.test';
import { testStreamByteCaps } from './streams.test';
import { testParseDf } from './df.test';

const suites: Array<[string, () => void]> = [
  ['images (template/version/label/env)', testImages],
  ['nodes (cidr/ip math)', testNet],
  ['uuid pipe', testUuidPipe],
  ['ws ticket (key separation)', testWsTicket],
  ['stream byte caps', testStreamByteCaps],
  ['df parse (disk guard)', testParseDf],
];

let failed = 0;
for (const [name, fn] of suites) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${name}:`, (e as Error).message);
  }
}
if (failed) {
  console.error(`${failed} suite(s) failed`);
  process.exit(1);
}
console.log('all unit suites passed');
