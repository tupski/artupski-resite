import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsRoute } from './SettingsRoute';
import { DEFAULT_CRAWLER_SETTINGS, useSettingsStore } from '../stores/settingsStore';
import { useAiStore } from '../stores/aiStore';

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsRoute />
    </MemoryRouter>
  );
}

describe('SettingsRoute', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      theme: 'dark',
      compactDensity: false,
      crawler: { ...DEFAULT_CRAWLER_SETTINGS }
    });
    useAiStore.getState().reset();
  });

  it('mounts the appearance, AI, crawler, security and workspace panels', () => {
    renderSettings();

    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /appearance/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /ai provider/i, level: 2 })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /crawler defaults/i, level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /security & privacy/i, level: 2 })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /workspace/i, level: 2 })).toBeInTheDocument();
  });

  it('replaces the old "Not configured (later phase)" workspace placeholder', () => {
    renderSettings();
    expect(screen.queryByText(/not configured \(later phase\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/app data location/i)).toBeInTheDocument();
  });
});
