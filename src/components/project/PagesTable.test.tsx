import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PagesTable } from './PagesTable';
import type { ScanPage } from '../../types/models';

function page(overrides: Partial<ScanPage> = {}): ScanPage {
  const url = overrides.url ?? 'https://example.com/';
  return {
    id: overrides.id ?? url,
    scanId: 's1',
    url,
    finalUrl: url,
    path: '/',
    depth: 0,
    httpStatus: 200,
    title: 'Home',
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    status: 'completed',
    authStatus: null,
    errorCode: null,
    errorMessage: null,
    loadTimeMs: 1,
    domContentLoadedTimeMs: 1,
    domNodeCount: 1,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rawHtmlPath: null,
    blueprintEvidencePath: null,
    ...overrides
  };
}

describe('PagesTable', () => {
  it('shows an honest empty state when there are no pages', () => {
    render(<PagesTable pages={[]} loading={false} error={null} />);
    expect(screen.getByText(/no pages recorded/i)).toBeInTheDocument();
  });

  it('renders a failed page as failed, never as completed', () => {
    render(
      <PagesTable
        pages={[page({ url: 'https://example.com/broken', title: 'Broken', status: 'failed', httpStatus: 500 })]}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('filters rows by URL or title', async () => {
    const user = userEvent.setup();
    render(
      <PagesTable
        pages={[
          page({ id: 'a', url: 'https://example.com/about', title: 'About' }),
          page({ id: 'b', url: 'https://example.com/contact', title: 'Contact' })
        ]}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox'), 'contact');
    expect(screen.queryByText('About')).not.toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
  });
});
