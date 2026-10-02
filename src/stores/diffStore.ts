/**
 * Visual diff store - Artupski ReSite
 *
 * Honest, read-mostly UI state for Phase 13 visual verification. It holds the
 * most recent `VisualDiffReport` plus an explicit lifecycle state, and exposes
 * loading/empty/error transitions. It never fabricates a similarity score: until
 * a run completes the report is `null` and the viewer renders an empty state.
 */
import { create } from 'zustand';
import type { VisualDiffReport } from '../types/visualDiff';

export type DiffStatus = 'idle' | 'running' | 'ready' | 'partial' | 'error';

export interface DiffState {
  status: DiffStatus;
  report: VisualDiffReport | null;
  error: { code: string; message: string; suggestedAction: string } | null;
  /** The route whose comparison is focused in the viewer (index by default). */
  activeProfile: string | null;
  /** Begin a run: clears any previous error but keeps the last report visible. */
  begin: () => void;
  /** Record a completed run and derive the honest status from it. */
  setReport: (report: VisualDiffReport) => void;
  /** Record a failure with an actionable message. */
  setError: (error: { code: string; message: string; suggestedAction: string }) => void;
  setActiveProfile: (profile: string) => void;
  clear: () => void;
  reset: () => void;
}

export const useDiffStore = create<DiffState>((set) => ({
  status: 'idle',
  report: null,
  error: null,
  activeProfile: null,

  begin: () => set({ status: 'running', error: null }),

  setReport: (report) =>
    set({
      report,
      error: report.error ?? null,
      activeProfile: report.comparisons[0]?.profile ?? null,
      status: !report.ok ? 'error' : report.summary.partial ? 'partial' : 'ready'
    }),

  setError: (error) => set({ status: 'error', error }),

  setActiveProfile: (profile) => set({ activeProfile: profile }),

  clear: () => set({ status: 'idle', report: null, error: null, activeProfile: null }),

  reset: () => set({ status: 'idle', report: null, error: null, activeProfile: null })
}));
