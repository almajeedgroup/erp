import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { notFound } from '@almajeed/shared';
import type { AppConfig } from '../config/env.js';

/**
 * Document storage.
 *
 * The interface is deliberately narrow — put, get, delete, exists — so the
 * local-filesystem driver used in development and tests and an object-store
 * driver in production are genuinely interchangeable, and no call site can
 * come to depend on filesystem semantics.
 *
 * Storage keys are **generated**, never derived from user input:
 *
 *   org_<id>/2026/03/<uuid>
 *
 * A key built from a filename is a path-traversal bug waiting for its first
 * `../`. `resolveSafe` below is the second line of defence: even a key that
 * somehow contained traversal cannot escape the storage root.
 */

export interface StoredObject {
  key: string;
  sizeBytes: number;
  /** SHA-256 of the stored bytes, hex. */
  checksum: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put: (key: string, body: Buffer, contentType: string) => Promise<StoredObject>;
  get: (key: string) => Promise<Buffer>;
  delete: (key: string) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
}

/** Build the storage key for a new upload. Contains no caller-supplied text. */
export function buildStorageKey(organizationId: string, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${organizationId}/${year}/${month}/${randomUUID()}`;
}

export function createLocalStorage(rootPath: string): StorageDriver {
  const root = resolve(rootPath);

  const resolveSafe = (key: string): string => {
    const target = resolve(join(root, key));
    // `resolve` collapses `..`; if the result is still under the root, the key
    // was harmless. If it is not, refuse rather than "sanitise and continue".
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Refusing storage key that escapes the root: ${key}`);
    }
    return target;
  };

  return {
    name: 'local',

    put: async (key, body) => {
      const target = resolveSafe(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body, { mode: 0o600 });
      return {
        key,
        sizeBytes: body.byteLength,
        checksum: createHash('sha256').update(body).digest('hex'),
      };
    },

    get: async (key) => {
      try {
        return await readFile(resolveSafe(key));
      } catch {
        throw notFound('Document contents');
      }
    },

    delete: async (key) => {
      await rm(resolveSafe(key), { force: true });
    },

    exists: async (key) => {
      try {
        await stat(resolveSafe(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function createStorage(config: AppConfig): StorageDriver {
  switch (config.storage.driver) {
    case 'local':
      return createLocalStorage(config.storage.localPath);
    case 's3':
      // Not yet implemented. This throws at boot rather than on the first
      // upload, so a misconfigured deployment fails immediately and visibly.
      // Tracked in docs/04-infrastructure/storage.md.
      throw new Error(
        'STORAGE_DRIVER=s3 is not implemented yet. Use STORAGE_DRIVER=local, or see ' +
          'docs/04-infrastructure/storage.md for the S3 driver contract.',
      );
  }
}
