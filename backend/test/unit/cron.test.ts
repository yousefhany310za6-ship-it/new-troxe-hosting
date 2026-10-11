import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { describeCron, isValidCron, nextRuns, parseCron } from '../../src/modules/servers/cron.ts';

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(Date.UTC(y, mo - 1, d, h, mi, 0));

describe('cron parsing', () => {
  it('accepts everyday shapes', () => {
    assert.ok(isValidCron('* * * * *'));
    assert.ok(isValidCron('*/5 * * * *'));
    assert.ok(isValidCron('0 0 * * *'));
    assert.ok(isValidCron('30 2 1 * *'));
    assert.ok(isValidCron('0 9-17 * * mon-fri'));
    assert.ok(isValidCron('15 14 1 * *'));
    assert.ok(isValidCron('0 0 * * 0'));
    assert.ok(isValidCron('0 0 * * 7'), 'Sunday as 7');
  });

  it('rejects non-5-field and exotic syntax', () => {
    for (const bad of ['', '  ', '* * * *', '* * * * * *', 'L * * * *', '* * ? * *', '*/0 * * * *', '61 * * * *', '0 25 * * *', '0 0 0 * *', '0 0 * 13 *', '0-100 * * * *', 'MONDAY * * * *']) {
      assert.equal(isValidCron(bad), false, JSON.stringify(bad));
    }
  });

  it('rejects out-of-range values', () => {
    assert.equal(isValidCron('60 * * * *'), false);
    assert.equal(isValidCron('* 24 * * *'), false);
    assert.equal(isValidCron('* * 32 * *'), false);
    assert.equal(isValidCron('* * * 0 *'), false);
    assert.equal(isValidCron('* * * * 8'), false);
  });
});

describe('next fire times (UTC)', () => {
  it('daily midnight fires at the next midnight', () => {
    const runs = nextRuns('0 0 * * *', at(2026, 5, 4, 12, 0), 2);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].toISOString(), '2026-05-05T00:00:00.000Z');
    assert.equal(runs[1].toISOString(), '2026-05-06T00:00:00.000Z');
  });

  it('every-minute fires on the next minute', () => {
    const runs = nextRuns('* * * * *', at(2026, 5, 4, 12, 0, 0), 2);
    assert.equal(runs[0].toISOString(), '2026-05-04T12:01:00.000Z');
    assert.equal(runs[1].toISOString(), '2026-05-04T12:02:00.000Z');
  });

  it('steps and weekday names work', () => {
    // Monday 2026-05-04; next Monday 09:00
    const runs = nextRuns('0 9 * * mon', at(2026, 5, 4, 10, 0), 1);
    assert.equal(runs[0].toISOString(), '2026-05-11T09:00:00.000Z');
  });

  it('day-of-month OR day-of-week semantics', () => {
    // 1st of month OR Friday: 2026-05-04 is a Monday, next fire is Friday 05-08
    const runs = nextRuns('0 0 1 * fri', at(2026, 5, 4, 0, 0), 1);
    assert.equal(runs[0].toISOString(), '2026-05-08T00:00:00.000Z');
  });

  it('is strictly after the reference time', () => {
    const ref = at(2026, 5, 4, 0, 0);
    const runs = nextRuns('0 0 * * *', ref, 1);
    assert.ok(runs[0].getTime() > ref.getTime());
  });
});

describe('describeCron', () => {
  it('summarises the common shapes', () => {
    assert.equal(describeCron('0 0 * * *'), 'Daily at 00:00 UTC');
    assert.match(describeCron('*/5 * * * *'), /UTC/);
    assert.match(describeCron('0 0 * * *'), /UTC/);
  });
});
