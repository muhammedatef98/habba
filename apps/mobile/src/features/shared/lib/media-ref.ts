/**
 * Durable references to objects in private storage buckets (0064).
 *
 * `storage://<bucket>/<path>` rather than a URL, because the reference is
 * written into the hash-chained timeline: a signed URL expires, and a project
 * URL would tie a permanent record to a hostname. Readers turn a reference
 * into something displayable through `repository.resolveMediaUrl()`.
 */

const SCHEME = 'storage://';

export interface StorageRef {
  readonly bucket: string;
  readonly path: string;
}

export function storageRef(bucket: string, path: string): string {
  return `${SCHEME}${bucket}/${path}`;
}

/** Null for anything that is not a storage reference — an http URL, a local file. */
export function parseStorageRef(ref: string): StorageRef | null {
  if (!ref.startsWith(SCHEME)) return null;

  const rest = ref.slice(SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;

  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}
