/**
 * The document the viewer screen shows.
 *
 * Handed over in memory rather than through route params: a document is a
 * whole page of HTML, and the report it came from was issued once by the
 * server (a token, a frozen payload) — re-deriving it from an id in the URL
 * would issue a second report every time the viewer opened. Lost on a cold
 * start, which the viewer handles by saying so and offering the way back.
 */

import { create } from 'zustand';
import type { ViewableDocument } from '@/features/shared/lib/report-pdf';

interface DocumentViewerState {
  readonly document: ViewableDocument | null;
  readonly show: (document: ViewableDocument) => void;
}

export const useDocumentViewer = create<DocumentViewerState>((set) => ({
  document: null,
  show: (document) => set({ document }),
}));
