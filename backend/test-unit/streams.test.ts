import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DockerService } from '../src/modules/servers/provisioning/docker.service';

/**
 * Bulk backup/restore streams must be hard-bounded: an oversized (or rogue)
 * volume could otherwise stream until the API host's disk is full.
 */
export async function testStreamByteCaps() {
  // pipeToHost/pipeToVolume are pure stream plumbing — call them off a
  // prototype instance so no Docker client / DB connection is needed.
  const svc: any = Object.create(DockerService.prototype);
  const dir = mkdtempSync(join(tmpdir(), 'troxe-cap-'));

  // AppError is an HttpException: the contract lives in getResponse(), not
  // in `.message` — assert on { statusCode, code } the way the API emits it.
  const isArchiveTooLarge = (e: any) => {
    const r = typeof e?.getResponse === 'function' ? e.getResponse() : undefined;
    return e?.status === 413 && r?.code === 'ARCHIVE_TOO_LARGE';
  };

  try {
    // ---- pipeToHost: over the ceiling -> rejects + partial file removed
    const over = join(dir, 'over.tar');
    await assert.rejects(
      () => svc.pipeToHost(Readable.from([Buffer.alloc(768 * 1024), Buffer.alloc(768 * 1024)]), over, 1024 * 1024),
      isArchiveTooLarge,
      'oversized archive stream must be rejected with ARCHIVE_TOO_LARGE/413',
    );
    assert.equal(existsSync(over), false, 'partial file must be deleted on breach');

    // ---- pipeToHost: under the ceiling -> succeeds, exact byte count
    const ok = join(dir, 'ok.tar');
    const n = await svc.pipeToHost(Readable.from([Buffer.alloc(100), Buffer.alloc(23)]), ok, 1024 * 1024);
    assert.equal(n, 123, 'byte count is exact');
    assert.equal(existsSync(ok), true, 'file written when under the cap');
    rmSync(ok, { force: true });

    // ---- pipeToHost: no ceiling configured -> unbounded but still counted
    const free = join(dir, 'free.tar');
    assert.equal(await svc.pipeToHost(Readable.from([Buffer.alloc(1)]), free), 1);
    rmSync(free, { force: true });

    // ---- pipeToVolume: oversized source refused BEFORE any upload happens
    const src = join(dir, 'src.tar');
    writeFileSync(src, Buffer.alloc(4096));
    let uploaded = 0;
    // mimic dockerode: putArchive consumes the archive stream and resolves
    // only once the daemon has taken the whole body
    const fakeContainer = {
      putArchive: (stream: any) =>
        new Promise<void>((resolve, reject) => {
          stream.on('data', (c: Buffer) => {
            uploaded += c.length;
          });
          stream.on('end', () => resolve());
          stream.on('error', reject);
        }),
    };
    await assert.rejects(
      () => svc.pipeToVolume(src, fakeContainer, '/data', 1024),
      isArchiveTooLarge,
      'oversized restore source must be refused up front',
    );
    assert.equal(uploaded, 0, 'nothing is pushed to the volume');

    // ---- pipeToVolume: source within the ceiling is uploaded (all bytes)
    await svc.pipeToVolume(src, fakeContainer, '/data', 64 * 1024);
    assert.equal(uploaded, 4096, 'every byte of the archive is pushed');
    // let the reader stream settle before the temp dir disappears (the error
    // path is exercised above; nothing must outlive the test)
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
