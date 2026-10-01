import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_CONFIGURATION, useScanStore } from './scanStore';

describe('scanStore', () => {
  beforeEach(() => {
    useScanStore.setState({
      targetUrl: '',
      projectTitle: '',
      status: 'idle',
      activePhase: '',
      progressPercent: 0,
      logs: [],
      discoveredPages: [],
      configuration: DEFAULT_SCAN_CONFIGURATION
    });
  });

  it('starts in the idle lifecycle state without fabricating progress', () => {
    const state = useScanStore.getState();
    expect(state.status).toBe('idle');
    expect(state.progressPercent).toBe(0);
    expect(state.logs).toHaveLength(0);
    expect(state.discoveredPages).toHaveLength(0);
  });

  it('updates the target URL', () => {
    useScanStore.getState().setTargetUrl('https://example.com');
    expect(useScanStore.getState().targetUrl).toBe('https://example.com');
  });

  it('merges configuration patches including nested viewports', () => {
    useScanStore.getState().updateConfiguration({ maxDepth: 4 });
    useScanStore.getState().updateConfiguration({ viewports: { tablet: true } } as never);

    const config = useScanStore.getState().configuration;
    expect(config.maxDepth).toBe(4);
    expect(config.viewports.tablet).toBe(true);
    // Untouched viewport flags survive a partial patch.
    expect(config.viewports.desktop).toBe(true);
  });

  it('appends structured log entries', () => {
    useScanStore.getState().appendLog('warn', 'example message');
    const [entry] = useScanStore.getState().logs;
    expect(entry?.level).toBe('warn');
    expect(entry?.message).toBe('example message');
    expect(entry?.timestamp).toBeTypeOf('string');
  });

  it('caps the log window instead of growing unbounded', () => {
    for (let i = 0; i < 1005; i++) {
      useScanStore.getState().appendLog('info', `line ${i}`);
    }
    expect(useScanStore.getState().logs.length).toBe(1000);
  });

  it('resets the lifecycle but preserves the configured target URL', () => {
    const store = useScanStore.getState();
    store.setTargetUrl('https://example.com');
    store.setStatus('scanning');
    store.appendLog('info', 'working');

    useScanStore.getState().resetScan();

    const state = useScanStore.getState();
    expect(state.status).toBe('idle');
    expect(state.logs).toHaveLength(0);
    expect(state.targetUrl).toBe('https://example.com');
  });
});
