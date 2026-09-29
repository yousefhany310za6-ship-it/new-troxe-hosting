import { Injectable, Logger } from '@nestjs/common';

// Thin wrapper around dockerode. Falls back to DB-only mode when
// no Docker daemon is available (e.g. local dev without VPS).
@Injectable()
export class DockerService {
  private readonly log = new Logger(DockerService.name);
  private docker: any = null;

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Docker = require('dockerode');
      this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    } catch (e) {
      this.log.warn('dockerode not available, running in DB-only mode');
    }
  }

  get enabled() {
    return !!this.docker && process.platform !== 'win32';
  }

  async start(containerId?: string | null) {
    if (!this.enabled || !containerId) return { mocked: true };
    await this.docker.getContainer(containerId).start();
    return { mocked: false };
  }

  async stop(containerId?: string | null) {
    if (!this.enabled || !containerId) return { mocked: true };
    await this.docker.getContainer(containerId).stop({ t: 10 });
    return { mocked: false };
  }

  async restart(containerId?: string | null) {
    if (!this.enabled || !containerId) return { mocked: true };
    await this.docker.getContainer(containerId).restart({ t: 10 });
    return { mocked: false };
  }
}
