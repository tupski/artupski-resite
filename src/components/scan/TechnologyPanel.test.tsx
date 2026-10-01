import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TechnologyPanel } from './TechnologyPanel';
import type { ScanTechnology } from '../../types/models';

function detection(overrides: Partial<ScanTechnology> = {}): ScanTechnology {
  return {
    id: 't1',
    scanId: 'scan-1',
    technologyId: 'nextjs',
    category: 'Meta-Framework & SSR Engine',
    name: 'Next.js',
    version: '14.2.1',
    confidenceStatus: 'detected',
    confidence: 0.95,
    versionStatus: 'exact',
    detectionSource: 'deterministic_rules',
    evidence: [{ vector: 'jsGlobals', evidence: '__NEXT_DATA__', weight: 1 }],
    pages: ['https://example.com/'],
    limitation: null,
    metadata: null,
    createdAt: '2026-01-01 00:00:00',
    ...overrides
  };
}

describe('TechnologyPanel', () => {
  it('renders persisted detections with name, category, version and confidence', () => {
    render(
      <TechnologyPanel detections={[detection()]} loading={false} error={null} partial={false} />
    );
    expect(screen.getByText('Next.js')).toBeInTheDocument();
    expect(screen.getByText('Meta-Framework & SSR Engine')).toBeInTheDocument();
    expect(screen.getByText('Detected')).toBeInTheDocument();
    expect(screen.getByText(/v14\.2\.1/)).toBeInTheDocument();
    expect(screen.getByText(/95% confidence/)).toBeInTheDocument();
  });

  it('shows an honest empty state when nothing was detected', () => {
    render(<TechnologyPanel detections={[]} loading={false} error={null} partial={false} />);
    expect(screen.getByText('No technologies detected')).toBeInTheDocument();
  });

  it('shows a loading state before results arrive', () => {
    render(<TechnologyPanel detections={[]} loading error={null} partial={false} />);
    expect(screen.getByText('Detecting technologies…')).toBeInTheDocument();
  });

  it('shows an alert on load failure (not an empty state)', () => {
    render(
      <TechnologyPanel
        detections={[]}
        loading={false}
        error="Detected technologies could not be loaded."
        partial={false}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
  });

  it('flags partial capture without hiding the results', () => {
    render(
      <TechnologyPanel detections={[detection()]} loading={false} error={null} partial />
    );
    expect(screen.getByRole('status')).toHaveTextContent('truncated');
    expect(screen.getByText('Next.js')).toBeInTheDocument();
  });

  it('labels a missing version instead of guessing', () => {
    render(
      <TechnologyPanel
        detections={[detection({ version: null, versionStatus: 'unavailable' })]}
        loading={false}
        error={null}
        partial={false}
      />
    );
    expect(screen.getByText('version n/a')).toBeInTheDocument();
  });

  it('exposes the detection list with an accessible label', () => {
    render(
      <TechnologyPanel detections={[detection()]} loading={false} error={null} partial={false} />
    );
    expect(screen.getByRole('list', { name: 'Detected technologies' })).toBeInTheDocument();
  });
});
