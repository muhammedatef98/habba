import { describe, expect, it } from 'vitest';
import type { CompletionMediaItem } from '@habba/core';
import {
  emptyDraft,
  parseDrafts,
  pendingUploads,
  readyToRecord,
  syncDrafts,
  withPhoto,
  withUpload,
  type DraftStore,
  type EvidenceDraft,
  type EvidenceSender,
} from './evidence-draft';

const NOW = new Date('2026-10-08T12:00:00Z');
const at = () => NOW;

function memoryStore(initial: readonly EvidenceDraft[]): DraftStore & {
  drafts: readonly EvidenceDraft[];
  discarded: string[];
} {
  const state = { drafts: initial, discarded: [] as string[] };
  return {
    get drafts() {
      return state.drafts;
    },
    discarded: state.discarded,
    load: async () => state.drafts,
    save: async (drafts) => {
      state.drafts = drafts;
    },
    discardFiles: async (orderId) => {
      state.discarded.push(orderId);
    },
  };
}

class Offline extends Error {}

function sender(options: {
  offline?: boolean;
  refuseRecord?: string;
  log?: string[];
}): EvidenceSender {
  return {
    uploadEvidencePhoto: async (orderId, kind, uri) => {
      if (options.offline === true) throw new Offline('network');
      options.log?.push(`upload ${kind} ${uri}`);
      return {
        kind,
        url: `storage://completion-media/${orderId}/${kind}.jpg`,
      } as CompletionMediaItem;
    },
    recordEvidence: async (orderId, mileage, media) => {
      if (options.offline === true) throw new Offline('network');
      if (options.refuseRecord !== undefined) throw new Error(options.refuseRecord);
      options.log?.push(`record ${orderId} ${mileage} ${media.length}`);
    },
  };
}

const transient = (cause: unknown) => cause instanceof Offline;

function readyDraft(): EvidenceDraft {
  let draft = emptyDraft('order-1', 90, NOW);
  draft = withPhoto(draft, 'before', 'file:///before.jpg', NOW);
  draft = withPhoto(draft, 'after', 'file:///after.jpg', NOW);
  return { ...draft, mileage: 61000, submitRequested: true };
}

describe('the draft', () => {
  it('replaces a retaken photo and forgets its upload', () => {
    let draft = withPhoto(emptyDraft('o', 30, NOW), 'before', 'file:///1.jpg', NOW);
    draft = withUpload(
      draft,
      'file:///1.jpg',
      { kind: 'before', url: 'u1' } as CompletionMediaItem,
      NOW,
    );
    draft = withPhoto(draft, 'before', 'file:///2.jpg', NOW);
    expect(draft.photos).toHaveLength(1);
    expect(pendingUploads(draft)).toHaveLength(1);
  });

  it('does not credit an upload to a photo taken after it started', () => {
    let draft = withPhoto(emptyDraft('o', 30, NOW), 'before', 'file:///new.jpg', NOW);
    draft = withUpload(
      draft,
      'file:///old.jpg',
      { kind: 'before', url: 'u' } as CompletionMediaItem,
      NOW,
    );
    expect(pendingUploads(draft)).toHaveLength(1);
  });

  it('is ready only when saved and everything is up', () => {
    const draft = readyDraft();
    expect(readyToRecord(draft)).toBe(false);
    const up = draft.photos.reduce(
      (d, p) =>
        withUpload(d, p.localUri, { kind: p.kind, url: p.localUri } as CompletionMediaItem, NOW),
      draft,
    );
    expect(readyToRecord(up)).toBe(true);
    expect(readyToRecord({ ...up, submitRequested: false })).toBe(false);
  });

  it('reads back what it wrote, and survives garbage', () => {
    const draft = readyDraft();
    expect(parseDrafts(JSON.stringify([draft]))).toEqual([draft]);
    expect(parseDrafts('{not json')).toEqual([]);
    expect(parseDrafts(null)).toEqual([]);
    expect(parseDrafts(JSON.stringify([{ nope: 1 }]))).toEqual([]);
  });
});

describe('the sync pass', () => {
  it('keeps everything when there is no signal', async () => {
    const store = memoryStore([readyDraft()]);
    const result = await syncDrafts(store, sender({ offline: true }), transient, at);
    expect(result.recorded).toEqual([]);
    expect(store.drafts).toHaveLength(1);
    expect(pendingUploads(store.drafts[0] as EvidenceDraft)).toHaveLength(2);
  });

  it('uploads, records, and clears once the signal is back', async () => {
    const log: string[] = [];
    const store = memoryStore([readyDraft()]);
    const result = await syncDrafts(store, sender({ log }), transient, at);
    expect(result.recorded).toEqual(['order-1']);
    expect(log).toEqual([
      'upload before file:///before.jpg',
      'upload after file:///after.jpg',
      'record order-1 61000 2',
    ]);
    expect(store.drafts).toEqual([]);
    expect(store.discarded).toEqual(['order-1']);
  });

  it('uploads but does not record a draft the technician has not saved', async () => {
    const store = memoryStore([{ ...readyDraft(), submitRequested: false }]);
    const result = await syncDrafts(store, sender({}), transient, at);
    expect(result.recorded).toEqual([]);
    expect(pendingUploads(store.drafts[0] as EvidenceDraft)).toHaveLength(0);
  });

  it('keeps a refusal on the draft and does not retry it on its own', async () => {
    const store = memoryStore([readyDraft()]);
    const first = await syncDrafts(
      store,
      sender({ refuseRecord: 'the order was cancelled' }),
      transient,
      at,
    );
    expect(first.refused).toEqual([{ orderId: 'order-1', reason: 'the order was cancelled' }]);
    expect(store.drafts[0]?.lastError).toBe('the order was cancelled');

    const log: string[] = [];
    await syncDrafts(store, sender({ log }), transient, at);
    expect(log.filter((line) => line.startsWith('record'))).toEqual([]);
  });
});
