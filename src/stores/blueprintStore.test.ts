/**
 * Blueprint store tests - Artupski ReSite
 *
 * Honest state coverage: empty, ready (valid+readable), partial (invalid or
 * unreadable), error (load failure), and generate reload. The IPC module is
 * mocked so no storage/Tauri shell is required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blueprintGetLatest = vi.fn();
const blueprintExport = vi.fn();
const blueprintGenerate = vi.fn();

vi.mock('../services/ipc', () => ({
  blueprintGetLatest: (...args: unknown[]) => blueprintGetLatest(...args),
  blueprintExport: (...args: unknown[]) => blueprintExport(...args),
  blueprintGenerate: (...args: unknown[]) => blueprintGenerate(...args)
}));

import { useBlueprintStore } from './blueprintStore';
import type { Blueprint as BlueprintRecord } from '../types/models';

function record(overrides: Partial<BlueprintRecord> = {}): BlueprintRecord {
  return {
    id: 'bp1',
    projectId: 'proj1',
    scanId: 's1',
    version: 1,
    schemaVersion: 1,
    filePath: 'v1/bp-s1-v1.json',
    isValid: true,
    validationErrors: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('blueprintStore', () => {
  beforeEach(() => {
    blueprintGetLatest.mockReset();
    blueprintExport.mockReset();
    blueprintGenerate.mockReset();
    useBlueprintStore.getState().reset();
  });

  afterEach(() => {
    useBlueprintStore.getState().reset();
  });

  it('is idle and empty with no scan id', async () => {
    await useBlueprintStore.getState().loadForScan(null);
    const state = useBlueprintStore.getState();
    expect(state.status).toBe('idle');
    expect(state.record).toBeNull();
  });

  it('reports empty when no Blueprint exists (never fabricated)', async () => {
    blueprintGetLatest.mockResolvedValue({ ok: true, data: null });
    await useBlueprintStore.getState().loadForScan('s1');
    const state = useBlueprintStore.getState();
    expect(state.status).toBe('empty');
    expect(state.record).toBeNull();
    expect(state.isValid).toBe(false);
    expect(blueprintExport).not.toHaveBeenCalled();
  });

  it('loads a valid, readable Blueprint as ready', async () => {
    blueprintGetLatest.mockResolvedValue({ ok: true, data: record() });
    blueprintExport.mockResolvedValue({
      ok: true,
      data: {
        blueprintId: 'bp1',
        version: 1,
        isValid: true,
        validationErrors: [],
        json: '{"blueprint_version":1}',
        document: { blueprint_version: 1 } as never,
        readError: null
      }
    });
    await useBlueprintStore.getState().loadForScan('s1');
    const state = useBlueprintStore.getState();
    expect(state.status).toBe('ready');
    expect(state.isValid).toBe(true);
    expect(state.partial).toBe(false);
    expect(state.document).not.toBeNull();
  });

  it('reports partial (honestly) when the document is invalid', async () => {
    blueprintGetLatest.mockResolvedValue({
      ok: true,
      data: record({
        isValid: false,
        validationErrors: [
          { code: 'BLUEPRINT_VALIDATION_FAILED', path: 'site.name', message: 'Required' }
        ]
      })
    });
    blueprintExport.mockResolvedValue({
      ok: true,
      data: {
        blueprintId: 'bp1',
        version: 1,
        isValid: false,
        validationErrors: [
          { code: 'BLUEPRINT_VALIDATION_FAILED', path: 'site.name', message: 'Required' }
        ],
        json: '{}',
        document: {} as never,
        readError: null
      }
    });
    await useBlueprintStore.getState().loadForScan('s1');
    const state = useBlueprintStore.getState();
    expect(state.status).toBe('partial');
    expect(state.isValid).toBe(false);
    expect(state.partial).toBe(true);
    expect(state.validationErrors).toHaveLength(1);
  });

  it('reports partial when the document body cannot be read', async () => {
    blueprintGetLatest.mockResolvedValue({ ok: true, data: record() });
    blueprintExport.mockResolvedValue({
      ok: true,
      data: {
        blueprintId: 'bp1',
        version: 1,
        isValid: true,
        validationErrors: [],
        json: null,
        document: null,
        readError: 'The Blueprint document could not be read from disk.'
      }
    });
    await useBlueprintStore.getState().loadForScan('s1');
    const state = useBlueprintStore.getState();
    expect(state.status).toBe('partial');
    expect(state.partial).toBe(true);
    expect(state.readError).toContain('could not be read');
  });

  it('reports a metadata read failure honestly as error', async () => {
    blueprintGetLatest.mockResolvedValue({
      ok: false,
      error: {
        code: 'STORAGE_READ_FAILED',
        category: 'database',
        message: 'boom',
        severity: 'error',
        recoverable: true,
        retryable: true,
        suggestedAction: 'retry',
        timestamp: new Date().toISOString()
      }
    });
    await useBlueprintStore.getState().loadForScan('s1');
    const state = useBlueprintStore.getState();
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('STORAGE_READ_FAILED');
  });

  it('generates then reloads from the database (source of truth)', async () => {
    blueprintGenerate.mockResolvedValue({
      ok: true,
      data: {
        blueprintId: 'bp1',
        version: 1,
        isValid: true,
        validationErrors: [],
        pageCount: 1,
        componentCount: 3,
        skippedPages: 0,
        partial: false,
        failed: false
      }
    });
    blueprintGetLatest.mockResolvedValue({ ok: true, data: record() });
    blueprintExport.mockResolvedValue({
      ok: true,
      data: {
        blueprintId: 'bp1',
        version: 1,
        isValid: true,
        validationErrors: [],
        json: '{}',
        document: {} as never,
        readError: null
      }
    });

    const ok = await useBlueprintStore.getState().generate({ scanId: 's1', projectId: 'proj1' });
    expect(ok).toBe(true);
    expect(blueprintGetLatest).toHaveBeenCalledWith('s1');
    expect(useBlueprintStore.getState().status).toBe('ready');
    expect(useBlueprintStore.getState().generating).toBe(false);
  });

  it('records a generate failure honestly', async () => {
    blueprintGenerate.mockResolvedValue({
      ok: false,
      error: {
        code: 'BLUEPRINT_VALIDATION_FAILED',
        category: 'blueprint',
        message: 'no pages',
        severity: 'error',
        recoverable: true,
        retryable: false,
        suggestedAction: 'retry',
        timestamp: new Date().toISOString()
      }
    });
    const ok = await useBlueprintStore.getState().generate({ scanId: 's1', projectId: 'proj1' });
    expect(ok).toBe(false);
    expect(useBlueprintStore.getState().error?.code).toBe('BLUEPRINT_VALIDATION_FAILED');
    expect(useBlueprintStore.getState().generating).toBe(false);
  });

  it('exports the loaded document as pretty JSON without a second read', async () => {
    blueprintGetLatest.mockResolvedValue({ ok: true, data: record() });
    blueprintExport.mockResolvedValue({
      ok: true,
      data: {
        blueprintId: 'bp1',
        version: 1,
        isValid: true,
        validationErrors: [],
        json: '{"a":1}',
        document: { blueprint_version: 1 } as never,
        readError: null
      }
    });
    await useBlueprintStore.getState().loadForScan('s1');
    blueprintExport.mockClear();
    const json = await useBlueprintStore.getState().exportJson();
    expect(json).toContain('blueprint_version');
    expect(blueprintExport).not.toHaveBeenCalled();
  });

  it('clears back to idle', async () => {
    blueprintGetLatest.mockResolvedValue({ ok: true, data: record() });
    blueprintExport.mockResolvedValue({
      ok: true,
      data: {
        blueprintId: 'bp1',
        version: 1,
        isValid: true,
        validationErrors: [],
        json: '{}',
        document: {} as never,
        readError: null
      }
    });
    await useBlueprintStore.getState().loadForScan('s1');
    useBlueprintStore.getState().clear();
    expect(useBlueprintStore.getState().status).toBe('idle');
    expect(useBlueprintStore.getState().record).toBeNull();
  });
});
