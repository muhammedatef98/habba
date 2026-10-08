/**
 * Completion evidence that survives a basement (CLAUDE.md §2.7, ADR-0012).
 *
 * Underground parking is where a flat battery actually happens, and it is
 * exactly where the photos used to fail: each was uploaded the moment it was
 * taken, and with no signal the technician got an error beside the car and
 * nothing saved. Now the photo is kept on the phone first, the upload is
 * attempted, and anything that did not go is a draft — on disk, surviving a
 * restart — that a sync pass finishes when there is a connection.
 *
 * What is queued is capture only, as ADR-0012 splits it: photos, mileage, the
 * warranty chosen, and the intent to save. Nothing here decides a state
 * transition; record_completion_evidence still validates everything on the
 * server when the draft is finally sent, and hand-back stays an online step.
 *
 * Pure: no React Native, no file system. Storage and the network are passed
 * in, so the sync pass is tested in Node like the rest of the domain logic.
 */

import type { CompletionMediaItem } from '@habba/core';

export type PhotoKind = CompletionMediaItem['kind'];

export interface DraftPhoto {
  readonly kind: PhotoKind;
  /** A copy kept in the app's own documents, not the camera's cache. */
  readonly localUri: string;
  /** Set once this exact file is in storage. */
  readonly uploaded: CompletionMediaItem | null;
}

export interface EvidenceDraft {
  readonly orderId: string;
  readonly mileage: number | null;
  readonly warrantyDays: number;
  readonly photos: readonly DraftPhoto[];
  /** The technician pressed save; send it as soon as everything is up. */
  readonly submitRequested: boolean;
  /** The server's last refusal, if it refused rather than went unreached. */
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export function emptyDraft(orderId: string, warrantyDays: number, now: Date): EvidenceDraft {
  return {
    orderId,
    mileage: null,
    warrantyDays,
    photos: [],
    submitRequested: false,
    lastError: null,
    updatedAt: now.toISOString(),
  };
}

/** A new photo of a kind replaces the old one, and is not uploaded yet. */
export function withPhoto(
  draft: EvidenceDraft,
  kind: PhotoKind,
  localUri: string,
  now: Date,
): EvidenceDraft {
  return {
    ...draft,
    photos: [
      ...draft.photos.filter((photo) => photo.kind !== kind),
      { kind, localUri, uploaded: null },
    ],
    lastError: null,
    updatedAt: now.toISOString(),
  };
}

/**
 * Records an upload — but only for the file that was uploaded. A photo
 * retaken while the old one was still going up must not inherit its result.
 */
export function withUpload(
  draft: EvidenceDraft,
  localUri: string,
  item: CompletionMediaItem,
  now: Date,
): EvidenceDraft {
  return {
    ...draft,
    photos: draft.photos.map((photo) =>
      photo.localUri === localUri ? { ...photo, uploaded: item } : photo,
    ),
    updatedAt: now.toISOString(),
  };
}

export function pendingUploads(draft: EvidenceDraft): readonly DraftPhoto[] {
  return draft.photos.filter((photo) => photo.uploaded === null);
}

export function uploadedMedia(draft: EvidenceDraft): readonly CompletionMediaItem[] {
  return draft.photos.flatMap((photo) => (photo.uploaded === null ? [] : [photo.uploaded]));
}

export function readyToRecord(draft: EvidenceDraft): boolean {
  return draft.submitRequested && pendingUploads(draft).length === 0;
}

/** Drafts read back from disk. Anything malformed is dropped, not thrown. */
export function parseDrafts(raw: string | null): readonly EvidenceDraft[] {
  if (raw === null || raw.trim() === '') return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is EvidenceDraft =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as EvidenceDraft).orderId === 'string' &&
        Array.isArray((entry as EvidenceDraft).photos),
    );
  } catch {
    return [];
  }
}

export interface DraftStore {
  load(): Promise<readonly EvidenceDraft[]>;
  save(drafts: readonly EvidenceDraft[]): Promise<void>;
  /** Removes the draft's kept photos once they are no longer needed. */
  discardFiles(orderId: string): Promise<void>;
}

export interface EvidenceSender {
  uploadEvidencePhoto(
    orderId: string,
    kind: PhotoKind,
    localUri: string,
  ): Promise<CompletionMediaItem>;
  recordEvidence(
    orderId: string,
    mileage: number,
    media: readonly CompletionMediaItem[],
    warrantyDays: number,
  ): Promise<void>;
}

/** True when a failure is the network's, and trying again later may work. */
export type IsTransient = (cause: unknown) => boolean;

export interface SyncResult {
  /** Orders whose evidence reached the server on this pass. */
  readonly recorded: readonly string[];
  /** Orders the server refused, with its reason. */
  readonly refused: readonly { orderId: string; reason: string }[];
}

/**
 * One pass over every draft: upload what is waiting, then record what is
 * complete. A transient failure leaves the draft for the next pass; a
 * refusal is kept on the draft, so the technician sees it, and not retried
 * on its own. Drafts are saved after every step, so a pass killed halfway
 * (the app closed, the phone died) loses nothing that had already gone up.
 */
export async function syncDrafts(
  store: DraftStore,
  sender: EvidenceSender,
  isTransient: IsTransient,
  now: () => Date = () => new Date(),
): Promise<SyncResult> {
  let drafts = [...(await store.load())];
  const recorded: string[] = [];
  const refused: { orderId: string; reason: string }[] = [];

  const replace = async (next: EvidenceDraft | null, orderId: string) => {
    drafts = drafts.flatMap((draft) =>
      draft.orderId !== orderId ? [draft] : next === null ? [] : [next],
    );
    await store.save(drafts);
  };

  for (const initial of [...drafts]) {
    let draft = initial;
    try {
      for (const photo of pendingUploads(draft)) {
        const item = await sender.uploadEvidencePhoto(draft.orderId, photo.kind, photo.localUri);
        draft = withUpload(draft, photo.localUri, item, now());
        await replace(draft, draft.orderId);
      }

      if (readyToRecord(draft) && draft.lastError === null) {
        await sender.recordEvidence(
          draft.orderId,
          draft.mileage ?? 0,
          uploadedMedia(draft),
          draft.warrantyDays,
        );
        await replace(null, draft.orderId);
        await store.discardFiles(draft.orderId);
        recorded.push(draft.orderId);
      }
    } catch (cause) {
      if (isTransient(cause)) continue;
      const reason = cause instanceof Error ? cause.message : String(cause);
      await replace({ ...draft, lastError: reason, updatedAt: now().toISOString() }, draft.orderId);
      refused.push({ orderId: draft.orderId, reason });
    }
  }

  return { recorded, refused };
}
