import { Logger, ValidationPipe, VersioningType, type LogLevel as NestLogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import * as path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { AppModule } from './app.module';
import { config } from './config/env';
import { DB } from './db/db.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Nest log levels at/above the configured LOG_LEVEL. */
const LOG_LEVELS: NestLogLevel[] = (() => {
  const order: NestLogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];
  return order.slice(order.indexOf(config.LOG_LEVEL as NestLogLevel));
})();

// last-resort crash handlers: an unhandled rejection means unknown
// in-flight state — log it and exit so the orchestrator restarts clean
// instead of serving traffic from a corrupted process (same as exceptions).
process.on('unhandledRejection', (reason) => {
  new Logger('UnhandledRejection').error(reason instanceof Error ? reason.stack : String(reason));
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  new Logger('UncaughtException').fatal(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

async function bootstrap() {
  // fail fast when a provider cannot initialize (never serve "healthy" deaf)
  const app = await NestFactory.create(AppModule, { abortOnError: true, logger: LOG_LEVELS });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ---- security headers (config module has already validated secrets) ------
  app.use(
    helmet({
      // this is a JSON API — CSP/COEP are irrelevant, CORP would break CORS
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
      crossOriginEmbedderPolicy: false,
      // HSTS only makes sense behind TLS; the edge (Vercel/nginx) terminates it
      hsts: config.IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());

  // file editor/upload payloads are JSON base64 (no multipart): raise the
  // default 100kb express limit once, and enforce tighter per-endpoint byte
  // caps in FilesService (512KB text, 2MB binary, 8MB download).
  app.use(json({ limit: '4mb' }));

  // ---- CORS: explicit allowlist, never "*" with credentials -----------------
  app.enableCors({
    origin: [...config.ALLOWED_ORIGINS],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  // ---- validation: strip unknown fields, reject unexpected ones ------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  // NOTE: RequestContextInterceptor is provided once via APP_INTERCEPTOR in
  // app.module.ts — registering it here as well would log every request twice.

  // correct client IPs for rate limiting / audit when behind a reverse proxy
  app.getHttpAdapter().getInstance().set('trust proxy', config.TRUST_PROXY);

  // ---- schema migrations, applied on boot ---------------------------------
  // drizzle-kit is a devDependency and the runtime image installs --omit=dev,
  // so the old `npx drizzle-kit migrate` deploy step could never run there
  // (and was `|| true`-swallowed): a fresh VPS used to boot "healthy" against
  // an EMPTY database. The drizzle migrator itself ships with drizzle-orm,
  // which IS a runtime dep — and `drizzle/` is copied into the image. Boot
  // fails fast if this fails, so we never serve traffic from a stale schema.
  const db = app.get(DB);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  new Logger('Bootstrap').log('schema migrations up to date');

  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');

  const log = new Logger('Bootstrap');
  log.log(`troxe-api listening on :${config.PORT} (${config.NODE_ENV})`);
  log.log(`allowed origins: ${config.ALLOWED_ORIGINS.join(', ')}`);
  log.log(`docker: ${process.env.DOCKER_ENABLED === 'false' ? 'disabled' : config.DOCKER_SOCKET}`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', e);
  process.exit(1);
});
