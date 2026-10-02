import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BlueprintPanel,
  MAX_RENDERED_VALIDATION_ERRORS,
  type BlueprintPanelProps
} from './BlueprintPanel';
import type { BlueprintRoot, BlueprintValidationError } from '../../types/blueprint';
import type { Blueprint as BlueprintRecord } from '../../types/models';

/**
 * Presentational coverage for the honest Blueprint viewer: valid, invalid,
 * empty, loading, partial (unreadable), and generation-failure states, plus
 * the validator badge, the validation-error list, export wiring, and the
 * no-fabrication guarantee (no counts when no document is loaded).
 */

function document_(overrides: Partial<BlueprintRoot> = {}): BlueprintRoot {
  const base: BlueprintRoot = {
    blueprint_version: 1,
    generated_at: '2026-10-01T00:00:00.000Z',
    source_url: 'https://example.com/',
    generator: { name: 'Artupski ReSite Engine', version: '1.0.0' },
    site: {
      name: 'Example',
      domain: 'example.com',
      canonical_url: 'https://example.com/',
      default_locale: 'en-US',
      supported_locales: ['en-US'],
      direction: 'ltr',
      favicon_url: '',
      theme_color: '',
      description: ''
    },
    pages: [
      {
        id: 'page_home',
        path: '/',
        title: 'Home',
        layout_id: 'layout_public',
        template: 'landing',
        is_dynamic: false,
        dynamic_param_names: [],
        meta: {},
        root_component_ids: []
      }
    ],
    routes: [
      {
        path: '/',
        page_id: 'page_home',
        auth_required: false,
        allowed_roles: [],
        redirect_to: null
      }
    ],
    components: [],
    layout: { default_layout_id: 'layout_public', definitions: [] },
    navigation: { primary_menu: [], footer_menu: [], user_menu: [] },
    content: { strings: {}, blocks: [] },
    assets: { images: [], icons: [], fonts: [] },
    design_system: {
      colors: {},
      typography: { font_sans: [], font_mono: [], font_sizes: {}, line_heights: {} },
      spacing: {},
      radii: {},
      shadows: {}
    },
    responsive_rules: { breakpoints: {}, overrides: [] },
    interactions: [],
    forms: [],
    authentication: { type: 'none', roles: [], protected_route_patterns: [] },
    technologies: {},
    seo: { default_title_template: '', open_graph: {}, twitter: {}, structured_data: [] },
    analytics: { providers: [], custom_events: [] },
    infrastructure: {
      node_version: '',
      package_manager: 'npm',
      recommended_target: 'static_spa',
      env_variables: [],
      build_command: '',
      output_directory: ''
    },
    admin_requirements: { entities: [] }
  };
  return { ...base, ...overrides };
}

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
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  };
}

function props(overrides: Partial<BlueprintPanelProps> = {}): BlueprintPanelProps {
  return {
    status: 'empty',
    record: null,
    document: null,
    validationErrors: [],
    isValid: false,
    partial: false,
    readError: null,
    loading: false,
    generating: false,
    error: null,
    canGenerate: true,
    onGenerate: vi.fn(),
    onExport: vi.fn(),
    ...overrides
  };
}

describe('BlueprintPanel', () => {
  it('renders a valid document with the Valid badge and real metadata', () => {
    render(
      <BlueprintPanel
        {...props({
          status: 'ready',
          record: record(),
          document: document_(),
          isValid: true
        })}
      />
    );
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByText('Blueprint version')).toBeInTheDocument();
    expect(screen.getByText('Schema version')).toBeInTheDocument();
    // Real page count (1) and route count (1) come from the document, not a guess.
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('Routes')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Blueprint JSON document' })).toHaveTextContent(
      '"blueprint_version": 1'
    );
    expect(screen.getByText(/passes the Blueprint schema/)).toBeInTheDocument();
  });

  it('renders the Invalid badge and an actionable, labelled error list', () => {
    const errors: BlueprintValidationError[] = [
      { code: 'BLUEPRINT_VALIDATION_FAILED', path: 'site.name', message: 'Required' },
      { code: 'BLUEPRINT_VALIDATION_FAILED', path: 'pages.0.path', message: 'Must start with "/"' }
    ];
    render(
      <BlueprintPanel
        {...props({
          status: 'partial',
          record: record({ isValid: false, validationErrors: errors }),
          document: document_(),
          validationErrors: errors,
          isValid: false,
          partial: true
        })}
      />
    );
    expect(screen.getByText('Invalid')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Blueprint validation errors' });
    expect(list).toHaveTextContent('site.name');
    expect(list).toHaveTextContent('Required');
    expect(list).toHaveTextContent('pages.0.path');
    expect(screen.getByText('Validation errors (2)')).toBeInTheDocument();
  });

  it('bounds the validation-error list and reports how many are hidden', () => {
    const errors: BlueprintValidationError[] = Array.from(
      { length: MAX_RENDERED_VALIDATION_ERRORS + 3 },
      (_, index) => ({
        code: 'BLUEPRINT_VALIDATION_FAILED' as const,
        path: `field.${index}`,
        message: 'invalid'
      })
    );
    render(
      <BlueprintPanel
        {...props({
          status: 'partial',
          record: record({ isValid: false, validationErrors: errors }),
          document: document_(),
          validationErrors: errors,
          isValid: false,
          partial: true
        })}
      />
    );
    expect(screen.getByText('3 more error(s) not shown.')).toBeInTheDocument();
  });

  it('shows an honest empty state when no Blueprint exists (no fabricated counts)', () => {
    render(<BlueprintPanel {...props()} />);
    expect(screen.getByText('No blueprint yet')).toBeInTheDocument();
    expect(screen.queryByText('Pages')).not.toBeInTheDocument();
    expect(screen.queryByText('Components')).not.toBeInTheDocument();
  });

  it('shows a loading state before results arrive', () => {
    render(<BlueprintPanel {...props({ status: 'loading', loading: true })} />);
    expect(screen.getByText('Loading Blueprint…')).toBeInTheDocument();
    expect(screen.queryByText('No blueprint yet')).not.toBeInTheDocument();
  });

  it('presents an unreadable document honestly as partial, never ready', () => {
    render(
      <BlueprintPanel
        {...props({
          status: 'partial',
          record: record({ isValid: true }),
          document: null,
          isValid: true,
          partial: true,
          readError: 'The Blueprint document could not be read from disk.'
        })}
      />
    );
    // The persisted validation is valid, but the body is unreadable: no false ready.
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText(/could not be read from disk/)).toBeInTheDocument();
    expect(screen.getByText(/raw JSON is unavailable/)).toBeInTheDocument();
    // No counts are shown because there is no document to count.
    expect(screen.queryByText('Pages')).not.toBeInTheDocument();
  });

  it('surfaces a generation failure as an alert and does not claim success', () => {
    render(
      <BlueprintPanel
        {...props({
          status: 'error',
          error: {
            code: 'BLUEPRINT_VALIDATION_FAILED',
            message: 'Failed to generate the Blueprint.',
            suggestedAction: 'Check that the scan completed, then retry.'
          }
        })}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to generate the Blueprint.');
    expect(screen.getByText('Check that the scan completed, then retry.')).toBeInTheDocument();
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
  });

  it('wires the generate and export actions', async () => {
    const onGenerate = vi.fn();
    const onExport = vi.fn();
    render(
      <BlueprintPanel
        {...props({
          status: 'ready',
          record: record(),
          document: document_(),
          isValid: true,
          onGenerate,
          onExport
        })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate blueprint' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Export Blueprint JSON' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('disables generation until the scan has completed', () => {
    render(<BlueprintPanel {...props({ canGenerate: false })} />);
    expect(screen.getByRole('button', { name: 'Generate blueprint' })).toBeDisabled();
    expect(screen.getByText(/once the scan has completed/)).toBeInTheDocument();
  });

  it('disables export when no Blueprint row exists', () => {
    render(<BlueprintPanel {...props()} />);
    expect(screen.getByRole('button', { name: 'Export Blueprint JSON' })).toBeDisabled();
  });
});
