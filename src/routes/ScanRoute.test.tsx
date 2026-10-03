import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ScanRoute } from './ScanRoute';
import { DEFAULT_SCAN_CONFIGURATION, useScanStore } from '../stores/scanStore';
import { DEFAULT_CRAWLER_SETTINGS, useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';

function renderScan() {
  return render(
    <MemoryRouter>
      <ScanRoute />
    </MemoryRouter>
  );
}

describe('ScanRoute crawler seeding', () => {
  beforeEach(() => {
    useScanStore.setState({
      targetUrl: '',
      projectId: null,
      projectTitle: '',
      status: 'idle',
      scanId: null,
      logs: [],
      discoveredPages: [],
      error: null,
      configuration: { ...DEFAULT_SCAN_CONFIGURATION }
    });
    useSettingsStore.setState({ crawler: { ...DEFAULT_CRAWLER_SETTINGS } });
    useAuthStore.getState().reset();
  });

  it('seeds the crawl configuration from persisted crawler settings', () => {
    useSettingsStore.setState({
      crawler: {
        maxDepth: 4,
        maxPages: 120,
        headless: false,
        captureViewports: true,
        generateBlueprint: true
      }
    });

    renderScan();

    expect(screen.getByLabelText(/max crawl depth/i)).toHaveValue(4);
    expect(screen.getByLabelText(/max pages/i)).toHaveValue(120);
    expect(screen.getByLabelText(/run headless/i)).not.toBeChecked();
    expect(screen.getByLabelText(/generate blueprint after crawl/i)).toBeChecked();

    const config = useScanStore.getState().configuration;
    expect(config.maxDepth).toBe(4);
    expect(config.maxPages).toBe(120);
    expect(config.headless).toBe(false);
    expect(config.blueprint).toBe(true);
    expect(config.viewports.desktop).toBe(true);
  });
});
