/**
 * Pages/routes/navigation modeling tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 11.
 */
import { describe, expect, it } from 'vitest';
import type { ScanPage } from '../../../types/models';
import { buildNavigation, buildPagesAndRoutes, inferDynamicPatterns } from '../routes';
import type { PageSegmentation } from '../domNormalizer';
import { model } from './fixtures';

function scanPage(overrides: Partial<ScanPage> = {}): ScanPage {
  return {
    id: 'p1',
    scanId: 's1',
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    path: '/',
    depth: 0,
    httpStatus: 200,
    title: 'Home',
    metaDescription: 'Welcome',
    canonicalUrl: 'https://example.com/',
    robotsMeta: 'index, follow',
    status: 'completed',
    authStatus: 'public',
    errorCode: null,
    errorMessage: null,
    loadTimeMs: 10,
    domContentLoadedTimeMs: 5,
    domNodeCount: 20,
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

function segment(pageId: string, path: string): PageSegmentation {
  return {
    pageId,
    url: `https://example.com${path}`,
    path,
    layoutId: 'layout_plain',
    template: 'content',
    rootComponentIds: []
  };
}

describe('inferDynamicPatterns', () => {
  it('requires at least two observed instances before inferring a param', () => {
    expect(inferDynamicPatterns(['/blog/a'])).toHaveLength(0);
    const patterns = inferDynamicPatterns(['/blog/a', '/blog/b']);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.pattern).toBe('/blog/:slug');
  });

  it('names a purely numeric position "id"', () => {
    const patterns = inferDynamicPatterns(['/users/1', '/users/2']);
    expect(patterns[0]?.pattern).toBe('/users/:id');
  });
});

describe('buildPagesAndRoutes', () => {
  it('builds pages + routes and marks dynamic pages honestly', () => {
    const inputs = [
      {
        page: scanPage({ id: 'a', path: '/blog/a', url: 'https://example.com/blog/a' }),
        segmentation: segment('a', '/blog/a')
      },
      {
        page: scanPage({ id: 'b', path: '/blog/b', url: 'https://example.com/blog/b' }),
        segmentation: segment('b', '/blog/b')
      }
    ];
    const result = buildPagesAndRoutes(inputs);
    expect(result.pages).toHaveLength(2);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.path).toBe('/blog/:slug');
    expect(result.pages.every((page) => page.is_dynamic)).toBe(true);
    expect(result.routes[0]?.route_params?.[0]?.name).toBe('slug');
  });

  it('marks auth-required routes from the observed authStatus, never from a guess', () => {
    const result = buildPagesAndRoutes([
      {
        page: scanPage({ id: 'd', path: '/dashboard', authStatus: 'auth_required' }),
        segmentation: segment('d', '/dashboard')
      }
    ]);
    expect(result.routes[0]?.auth_required).toBe(true);
    expect(result.protectedPatterns).toContain('/dashboard');
  });

  it('keeps non-slash-root paths and emits meta from observed values', () => {
    const result = buildPagesAndRoutes([
      { page: scanPage({ id: 'h', path: '/' }), segmentation: segment('h', '/') }
    ]);
    expect(result.pages[0]?.path.startsWith('/')).toBe(true);
    expect(result.pages[0]?.meta.robots).toBe('index, follow');
    expect(result.pages[0]?.meta.canonical).toBe('https://example.com/');
  });
});

describe('buildNavigation', () => {
  it('builds nested menus and routes account items to the user menu', () => {
    const evidenceModel = model({
      nav: [
        {
          region: 'header',
          label: 'Primary',
          items: [
            { href: '/features', text: 'Features', target: null, depth: 0 },
            { href: '/features/sync', text: 'Real-time Sync', target: null, depth: 1 }
          ]
        },
        {
          region: 'header',
          label: 'Account',
          items: [{ href: '/login', text: 'Sign In', target: null, depth: 0 }]
        }
      ]
    });
    const result = buildNavigation([evidenceModel], ['/dashboard']);
    expect(result.navigation.primary_menu[0]?.children?.[0]?.href).toBe('/features/sync');
    expect(result.navigation.user_menu[0]?.label).toBe('Sign In');
    expect(result.userMenuObserved).toBe(true);
  });

  it('marks a nav item requiring auth when its target is a protected route', () => {
    const evidenceModel = model({
      nav: [
        {
          region: 'header',
          label: 'Primary',
          items: [{ href: '/dashboard', text: 'Dashboard', target: null, depth: 0 }]
        }
      ]
    });
    const result = buildNavigation([evidenceModel], ['/dashboard']);
    const item = [...result.navigation.primary_menu, ...result.navigation.user_menu].find(
      (entry) => entry.href === '/dashboard'
    );
    expect(item?.requires_auth).toBe(true);
  });

  it('returns empty menus when there is no navigation evidence', () => {
    const result = buildNavigation([model({})], []);
    expect(result.navigation).toEqual({ primary_menu: [], footer_menu: [], user_menu: [] });
    expect(result.userMenuObserved).toBe(false);
  });
});
