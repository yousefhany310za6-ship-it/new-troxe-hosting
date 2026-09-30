import { Logger, ValidationPipe, VersioningType, type LogLevel as NestLogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Nest log levels at/above the configured LOG_LEVEL. */
const LOG_LEVELS: NestLogLevel[] = (() => {
  const order: NestLogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];
  return order.slice(order.indexOf(config.LOG_LEVEL as NestLogLevel));
})();

// last-resort crash handlers: Node 22 throws on unhandled rejections, so
// without these a single missed `await` kills the process with no log line.
process.on('unhandledRejection', (reason) => {
  new Logger('UnhandledRejection').error(reason instanceof Error ? reason.stack : String(reason));
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
