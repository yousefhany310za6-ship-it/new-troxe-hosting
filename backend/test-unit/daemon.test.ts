import { strict as assert } from 'node:assert';
import { boundedStr, decodeDockerLogs, decodeLogsBounded, finiteNum } from '../src/modules/servers/provisioning/docker.service';

/** One docker log frame: type(1) | 000(3) | len(4 BE) | payload. */
function frame(payload: string, type = 1): Buffer {
  const body = Buffer.from(payload);
  const head = Buffer.alloc(8);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

export function testDaemonDecoding() {
  // ---- a well-formed stream decodes exactly
  const good = Buffer.concat([frame('hello '), frame('world')]);
  assert.equal(decodeDockerLogs(good), 'hello world', 'multi-frame stream decodes');

  // ---- empty / non-framed input degrades to raw text, never throws
  assert.equal(decodeDockerLogs(Buffer.alloc(0)), '', 'empty buffer');
  assert.equal(decodeDockerLogs(Buffer.from('plain text')), 'plain text', 'unframed input falls back to text');

  // ---- the LAST frame may be truncated by the daemon: stop, no garbage
  const cut = Buffer.concat([frame('ok'), frame('truncated')]).subarray(0, 8 + 2 + 8 + 5);
  assert.equal(decodeDockerLogs(cut), 'ok', 'incomplete trailing frame is dropped');

  // ---- TAIL slice (what the raw cap produces): must RESYNC to the next
  // frame header instead of returning the raw bytes as text. Without resync
  // the old decoder returned `buf.toString()` — frame headers and binary
  // junk straight into the logs page.
  const three = Buffer.concat([frame('A'.repeat(16)), frame('B'.repeat(16)), frame('C'.repeat(16))]);
  const midFrame = decodeDockerLogs(three.subarray(10)); // starts inside frame A's payload
  assert.equal(midFrame, 'B'.repeat(16) + 'C'.repeat(16), 'decoder resyncs to the next real header');
  assert.ok(!midFrame.includes('\x00'), 'no raw frame bytes leak into the decoded text');

  // ---- hostile frame: huge declared length is never read out of bounds
  const evil = Buffer.alloc(64);
  evil.writeUInt32BE(0xfffffff0, 4);
  assert.equal(decodeDockerLogs(evil), evil.toString('utf8'), 'absurd length falls back instead of crashing');

  // ---- raw cap: a 12MB stream is decoded from its TAIL, bounded in memory
  const huge = Buffer.concat(Array.from({ length: 12 }, () => frame('y'.repeat(1024 * 1024))));
  assert.ok(huge.length > 11 * 1024 * 1024, 'fixture really is >11MB');
  const decoded = decodeLogsBounded(huge);
  assert.ok(decoded.length <= 9 * 1024 * 1024, `bounded decode stayed under the 8MB raw cap (got ${decoded.length})`);
  assert.ok(decoded.startsWith('y') && decoded.endsWith('y'), 'tail frames decode as payload, not header junk');
  assert.ok(!decoded.includes('\x00'), 'capped decode carries no frame bytes');
  assert.equal(decoded.length % (1024 * 1024), 0, 'whole frames only — no half frame at the cut');

  // ---- a small stream is untouched by the cap
  assert.equal(decodeLogsBounded(good), 'hello world', 'short logs are byte-identical');
}

export function testDaemonShapeGuards() {
  // ---- numbers coming back from a node must be finite, or JSON gets nulls
  assert.equal(finiteNum(42), 42, 'plain number');
  assert.equal(finiteNum('17.5'), 17.5, 'numeric string is coerced');
  assert.equal(finiteNum(Number.NaN), 0, 'NaN -> 0');
  assert.equal(finiteNum(Number.POSITIVE_INFINITY), 0, '+Infinity -> 0');
  assert.equal(finiteNum(undefined), 0, 'missing -> 0');
  assert.equal(finiteNum(null), 0, 'null -> 0');
  assert.equal(finiteNum('not-a-number'), 0, 'junk -> 0');
  assert.equal(finiteNum({}), 0, 'object -> 0');

  // ---- strings we store (lastError) or echo (status/version) are bounded
  assert.equal(boundedStr('x'.repeat(5000), 500).length, 500, 'long string is sliced');
  assert.equal(boundedStr('running', 32), 'running', 'short string unchanged');
  assert.equal(boundedStr(12345, 32), '', 'non-string -> empty');
  assert.equal(boundedStr(undefined, 32), '', 'missing -> empty');
  assert.equal(boundedStr({ a: 1 }, 32), '', 'object -> empty');

  // ---- 12MB daemon log still fits the response contract (4MB + marker)
  const lines = Array.from({ length: 12 }, (_, i) => `line ${i} ` + 'z'.repeat(1024 * 1024)).join('\n');
  const stream = Buffer.concat(lines.split('\n').map((l) => frame(l)));
  const text = decodeLogsBounded(stream);
  assert.ok(text.length > 4 * 1024 * 1024, 'fixture exceeds the text ceiling');
  const served = text.length > 4 * 1024 * 1024 ? text.slice(-4 * 1024 * 1024) : text;
  assert.equal(served.length, 4 * 1024 * 1024, 'served text is clamped to the 4MB ceiling');
}
