import { beforeEach, describe, expect, it } from 'vitest';
import { useDiffStore } from './diffStore';
import type { VisualDiffReport } from '../types/visualDiff';

function report(overrides: Partial<VisualDiffReport['summary']> = {}): VisualDiffReport {
  return {
    ok: true,
    comparisons: [
      {
        profile: 'desktop',
        compared: true,
        width: 10,
        height: 10,
        mismatchedPixels: 0,
        totalPixels: 100,
        similarityPercent: 100,
        discrepancies: [],
        skippedReason: null,
        diffPng: null
      }
    ],
    summary: {
      viewports: 1,
      compared: 1,
      skipped: 0,
      averageSimilarityPercent: 100,
      mismatchedPixels: 0,
      totalPixels: 100,
      partial: false,
      ...overrides
    },
    aborted: false
  };
}

describe('diffStore', () => {
  beforeEach(() => {
    useDiffStore.getState().reset();
  });

  it('starts idle with no report', () => {
    const state = useDiffStore.getState();
    expect(state.status).toBe('idle');
    expect(state.report).toBeNull();
  });

  it('derives ready from a complete report', () => {
    useDiffStore.getState().setReport(report());
    const state = useDiffStore.getState();
    expect(state.status).toBe('ready');
    expect(state.activeProfile).toBe('desktop');
  });

  it('derives partial when a viewport was skipped', () => {
    useDiffStore.getState().setReport(report({ compared: 0, skipped: 1, partial: true }));
    expect(useDiffStore.getState().status).toBe('partial');
  });

  it('derives error from a failed report and surfaces its message', () => {
    useDiffStore.getState().setReport({
      ok: false,
      comparisons: [],
      summary: {
        viewports: 0,
        compared: 0,
        skipped: 0,
        averageSimilarityPercent: 0,
        mismatchedPixels: 0,
        totalPixels: 0,
        partial: false
      },
      aborted: false,
      error: { code: 'NO_ROUTES', message: 'No routes.', suggestedAction: 'Generate first.' }
    });
    const state = useDiffStore.getState();
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('NO_ROUTES');
  });

  it('clears back to idle', () => {
    useDiffStore.getState().setReport(report());
    useDiffStore.getState().clear();
    expect(useDiffStore.getState().status).toBe('idle');
    expect(useDiffStore.getState().report).toBeNull();
  });
});
