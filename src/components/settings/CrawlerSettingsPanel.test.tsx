import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CrawlerSettingsPanel } from './CrawlerSettingsPanel';
import { DEFAULT_CRAWLER_SETTINGS, useSettingsStore } from '../../stores/settingsStore';

describe('CrawlerSettingsPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ crawler: { ...DEFAULT_CRAWLER_SETTINGS } });
    window.localStorage.clear();
  });

  it('renders the persisted values', () => {
    useSettingsStore.setState({
      crawler: { ...DEFAULT_CRAWLER_SETTINGS, maxDepth: 4, maxPages: 120, headless: false }
    });
    render(<CrawlerSettingsPanel />);

    expect(screen.getByLabelText(/max crawl depth/i)).toHaveValue(4);
    expect(screen.getByLabelText(/max pages/i)).toHaveValue(120);
    expect(screen.getByLabelText(/run headless/i)).not.toBeChecked();
  });

  it('commits a valid numeric change to the store', async () => {
    const user = userEvent.setup();
    render(<CrawlerSettingsPanel />);

    const depth = screen.getByLabelText(/max crawl depth/i);
    await user.clear(depth);
    await user.type(depth, '5');

    expect(useSettingsStore.getState().crawler.maxDepth).toBe(5);
  });

  it('toggles a boolean setting into the store', async () => {
    const user = userEvent.setup();
    render(<CrawlerSettingsPanel />);

    await user.click(screen.getByLabelText(/generate blueprint/i));
    expect(useSettingsStore.getState().crawler.generateBlueprint).toBe(true);
  });

  it('shows an actionable inline error for an out-of-range value without writing it', async () => {
    const user = userEvent.setup();
    render(<CrawlerSettingsPanel />);

    const pages = screen.getByLabelText(/max pages/i);
    await user.clear(pages);
    await user.type(pages, '9999');

    expect(screen.getByRole('alert')).toHaveTextContent(/between 1 and 200/i);
    // The invalid value is never persisted; the store stays within bounds.
    const persisted = useSettingsStore.getState().crawler.maxPages;
    expect(persisted).not.toBe(9999);
    expect(persisted).toBeLessThanOrEqual(200);
    expect(persisted).toBeGreaterThanOrEqual(1);
  });

  it('clamps an out-of-range value on blur', async () => {
    const user = userEvent.setup();
    render(<CrawlerSettingsPanel />);

    const depth = screen.getByLabelText(/max crawl depth/i);
    await user.clear(depth);
    await user.type(depth, '99');
    await user.tab();

    expect(useSettingsStore.getState().crawler.maxDepth).toBe(5);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('states plainly that crawler concurrency is fixed at 1', () => {
    render(<CrawlerSettingsPanel />);
    const note = screen.getByTestId('crawler-concurrency-note');
    expect(note).toHaveTextContent(/concurrency is fixed at 1/i);
  });

  it('does not render a fake concurrency control', () => {
    render(<CrawlerSettingsPanel />);
    expect(screen.queryByLabelText(/concurrency/i)).not.toBeInTheDocument();
  });
});
