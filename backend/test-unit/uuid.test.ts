import { strict as assert } from 'node:assert';
import { ParseUuidPipe } from '../src/common/pipes/uuid.pipe';

export function testUuidPipe() {
  const pipe = new ParseUuidPipe();
  const good = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(pipe.transform(good), good);
  // Nest wraps details in getResponse(): assert the machine code, not text
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as { getResponse?: () => { code?: string } }).getResponse?.()?.code;
    }
    return 'NO-THROW';
  };
  for (const bad of ['', 'not-a-uuid', '123', 123 as never, null as never, undefined as never, '../etc', '123e4567-e89b-12d3-a456-42661417400']) {
    assert.equal(codeOf(() => pipe.transform(bad)), 'NOT_FOUND', JSON.stringify(bad));
  }
}
