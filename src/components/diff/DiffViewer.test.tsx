import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiffViewer } from './DiffViewer';
import type { ViewportComparison, VisualDiffReport } from '../../types/visualDiff';

function comparison(overrides: Partial<ViewportComparison> = {}): ViewportComparison {
  return {
    profile: 'desktop',
    compared: true,
    width: 1440,
    height: 900,
    mismatchedPixels: 10,
    totalPixels: 1000,
    similarityPercent: 99,
    discrepancies: [
      { kind: 'pixel_mismatch', message: '10 of 1000 pixels differ (1.00%).', severity: 'warning' }
    ],
    skippedReason: null,
    diffPng: new Uint8Array([137, 80, 78, 71]),
    ...overrides
  };
}

function report(comparisons: ViewportComparison[], partial = false): VisualDiffReport {
  const compared = comparisons.filter((entry) => entry.compared).length;
  return {
    ok: true,
    comparisons,
    summary: {
      viewports: comparisons.length,
      compared,
      skipped: comparisons.length - compared,
      averageSimilarityPercent: 99,
      mismatchedPixels: 10,
      totalPixels: 1000,
      partial
    },
    aborted: false
  };
}

describe('DiffViewer', () => {
  it('renders an honest empty state with no report', () => {
    render(<DiffViewer report={null} loading={false} error={null} />);
    expect(screen.getByText('No comparison yet')).toBeInTheDocument();
  });

  it('shows a loading state before results arrive', () => {
    render(<DiffViewer report={null} loading error={null} />);
    expect(screen.getByText(/Comparing the generated project/i)).toBeInTheDocument();
  });

  it('shows an alert on failure (not an empty state)', () => {
    render(<DiffViewer report={null} loading={false} error="Comparison failed." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Comparison failed.');
  });

  it('renders the mismatch score, pixel counts and discrepancies', () => {
    render(<DiffViewer report={report([comparison()])} loading={false} error={null} />);
    expect(screen.getByText(/99\.00% match/)).toBeInTheDocument();
    expect(screen.getByText(/10 of 1000 pixels differ/)).toBeInTheDocument();
    expect(screen.getByText('Pixel mismatch')).toBeInTheDocument();
  });

  it('marks a partial run', () => {
    render(
      <DiffViewer
        report={report(
          [
            comparison(),
            comparison({ profile: 'mobile', compared: false, skippedReason: 'no capture' })
          ],
          true
        )}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('mobile (skipped)')).toBeInTheDocument();
  });

  it('switches to the pixel-diff mode and shows the diff image', async () => {
    const user = userEvent.setup();
    render(<DiffViewer report={report([comparison()])} loading={false} error={null} />);
    await user.click(screen.getByRole('tab', { name: 'Pixel diff' }));
    expect(screen.getByAltText(/Pixel diff highlighting mismatched regions/i)).toBeInTheDocument();
  });

  it('invokes onSelectProfile when a viewport tab is chosen', async () => {
    const user = userEvent.setup();
    const onSelectProfile = vi.fn();
    render(
      <DiffViewer
        report={report([comparison(), comparison({ profile: 'tablet' })])}
        loading={false}
        error={null}
        onSelectProfile={onSelectProfile}
      />
    );
    await user.click(screen.getByRole('tab', { name: 'tablet' }));
    expect(onSelectProfile).toHaveBeenCalledWith('tablet');
  });
});
