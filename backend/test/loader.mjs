/**
 * Minimal ESM resolver for unit tests: the NestJS sources use extensionless
 * relative imports (resolved by tsc at build time), which plain Node ESM
 * rejects. This appends `.ts` (or `/index.ts`) when the bare specifier
 * fails — tests only, never production code.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (
      e?.code === 'ERR_MODULE_NOT_FOUND' &&
      typeof specifier === 'string' &&
      (specifier.startsWith('./') || specifier.startsWith('../'))
    ) {
      const parentPath = fileURLToPath(context.parentURL);
      const base = path.resolve(path.dirname(parentPath), specifier);
      for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
    throw e;
  }
}
