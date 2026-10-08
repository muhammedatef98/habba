/**
 * Where evidence drafts live on the phone, and the one sync pass the app runs.
 *
 * The app's documents directory, not the cache: the camera writes into the
 * cache, which the OS may clear while the phone is low on space — the very
 * moment a technician is most likely to be stuck underground with a full
 * day of photos. A copy is made the instant the photo is taken.
 *
 * The web preview has no file system; there the drafts live in memory, which
 * is enough to exercise the screens.
 */

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { getNetworkStateAsync } from 'expo-network';
import { providerRepository } from '@/features/provider/data/provider-repository';
import {
  parseDrafts,
  syncDrafts,
  type DraftStore,
  type EvidenceDraft,
  type PhotoKind,
  type SyncResult,
} from './evidence-draft';

const ROOT = 'evidence';
const INDEX = 'drafts.json';

let memory: readonly EvidenceDraft[] = [];

function root(): Directory {
  const dir = new Directory(Paths.document, ROOT);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export const draftStore: DraftStore = {
  async load() {
    if (Platform.OS === 'web') return memory;
    const file = new File(root(), INDEX);
    return file.exists ? parseDrafts(await file.text()) : [];
  },
  async save(drafts) {
    if (Platform.OS === 'web') {
      memory = drafts;
      return;
    }
    const file = new File(root(), INDEX);
    if (!file.exists) file.create();
    file.write(JSON.stringify(drafts));
  },
  async discardFiles(orderId) {
    if (Platform.OS === 'web') return;
    const dir = new Directory(root(), orderId);
    if (dir.exists) dir.delete();
  },
};

/** Copies a camera shot out of the cache into the draft's own folder. */
export async function keepPhoto(
  orderId: string,
  kind: PhotoKind,
  cameraUri: string,
): Promise<string> {
  if (Platform.OS === 'web') return cameraUri;
  const dir = new Directory(root(), orderId);
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, `${kind}-${Date.now()}.jpg`);
  await new File(cameraUri).copy(target);
  return target.uri;
}

export async function loadDraft(orderId: string): Promise<EvidenceDraft | null> {
  return (await draftStore.load()).find((draft) => draft.orderId === orderId) ?? null;
}

export async function saveDraft(draft: EvidenceDraft): Promise<void> {
  const others = (await draftStore.load()).filter((entry) => entry.orderId !== draft.orderId);
  await draftStore.save([...others, draft]);
}

/**
 * A failure worth retrying: the phone says it is offline, or the error reads
 * like a connection that never completed. Anything else is the server
 * answering no, and is shown rather than retried.
 */
async function isTransientNow(cause: unknown): Promise<boolean> {
  try {
    const state = await getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) return true;
  } catch {
    // Unknown connectivity: fall through to the message.
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return /network|fetch|timed? ?out|timeout|offline|ECONN|socket|abort/i.test(message);
}

let running: Promise<SyncResult> | null = null;

/**
 * Runs one pass, or joins the one already running. The screen, the reconnect
 * listener and the app coming to the foreground can all ask at once; only
 * one pass touches the drafts at a time.
 */
export function syncEvidenceNow(): Promise<SyncResult> {
  if (running !== null) return running;
  const transientFlags = new Map<unknown, boolean>();
  running = (async () => {
    try {
      return await syncDrafts(
        draftStore,
        {
          uploadEvidencePhoto: async (orderId, kind, uri) => {
            try {
              return await providerRepository.uploadEvidencePhoto(orderId, kind, uri);
            } catch (cause) {
              transientFlags.set(cause, await isTransientNow(cause));
              throw cause;
            }
          },
          recordEvidence: async (orderId, mileage, media, warrantyDays) => {
            try {
              await providerRepository.recordEvidence(orderId, mileage, media, warrantyDays);
            } catch (cause) {
              transientFlags.set(cause, await isTransientNow(cause));
              throw cause;
            }
          },
        },
        (cause) => transientFlags.get(cause) ?? true,
      );
    } finally {
      running = null;
    }
  })();
  return running;
}
