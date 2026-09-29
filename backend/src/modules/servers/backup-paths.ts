import path from 'path';
import { config } from '../../config/env';

/**
 * Filesystem anchors for backup archives on disk:
 *   BACKUP_DIR/<ownerId>/<serverId>/<backupId>.tar.gz
 *
 * Pure functions in their own module so both BackupsService and
 * ServersService (server/account deletion removes files) can use them
 * without creating a service cycle.
 */
export function backupOwnerDir(ownerId: string): string {
  return path.resolve(config.BACKUP_DIR, ownerId);
}

export function backupDirFor(ownerId: string, serverId: string): string {
  return path.resolve(backupOwnerDir(ownerId), serverId);
}
