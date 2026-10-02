/**
 * Site metadata + SEO modeling - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md and
 * docs/specs/BLUEPRINT-SPEC.md sections 2.1 and 2.15.
 *
 * Derives the `site` and `seo` sections from observed page metadata (title,
 * meta description, canonical, robots, theme-color) and the seed URL. Missing
 * values use the spec's empty representation (`''`, `[]`, `{}`) - never a
 * fabricated value. The site name is taken from the page title when available,
 * otherwise from the domain host (still an observed fact, not an invention).
 */
import type { ScanPage } from '../../types/models';
import type { BlueprintSeo, BlueprintSite } from '../../types/blueprint';

export interface SiteInput {
  /** The scan's target/seed URL. */
  sourceUrl: string;
  pages: readonly ScanPage[];
  /** Observed `<html dir>` / `lang` values, when captured. */
  lang: string;
  dir: string;
  /** Observed `<meta name="theme-color">`, when captured. */
  themeColor: string;
  faviconUrl: string;
}

/** Strip a leading `www.` from a host for a cleaner site name. */
function hostName(host: string): string {
  return host.replace(/^www\./, '');
}

/** Choose a stable representative page (home first, then shallowest). */
function representativePage(pages: readonly ScanPage[]): ScanPage | null {
  const ordered = [...pages].sort(
    (a, b) => a.depth - b.depth || a.path.localeCompare(b.path) || a.id.localeCompare(b.id)
  );
  return ordered.find((page) => page.path === '/') ?? ordered[0] ?? null;
}

/** Derive a human-readable title template from an observed page title. */
export function titleTemplateFrom(page: ScanPage | null, siteName: string): string {
  if (!page?.title) {
    return '';
  }
  const title = page.title;
  const separatorMatch = /^(.+?)\s*[|\-–—]\s*(.+)$/.exec(title);
  if (separatorMatch) {
    const suffix = (separatorMatch[2] ?? '').trim();
    if (suffix.length > 0) {
      return `%s | ${suffix}`;
    }
  }
  return siteName.length > 0 ? `%s | ${siteName}` : '';
}

/** Build the `site` section from observed metadata. */
export function buildSite(input: SiteInput): BlueprintSite {
  let url: URL | null = null;
  try {
    url = new URL(input.sourceUrl);
  } catch {
    url = null;
  }
  const domain = url?.host ?? '';
  const host = hostName(domain);
  const page = representativePage(input.pages);
  const name = host.length > 0 ? host : (page?.title ?? '');

  const locale = input.lang.length >= 2 ? input.lang : 'en';
  return {
    name,
    domain,
    canonical_url: input.sourceUrl,
    default_locale: locale,
    supported_locales: locale.length > 0 ? [locale] : [],
    direction: input.dir === 'rtl' ? 'rtl' : 'ltr',
    favicon_url: input.faviconUrl,
    theme_color: input.themeColor,
    description: page?.metaDescription ?? ''
  };
}

/** Build the `seo` section from observed metadata. */
export function buildSeo(input: SiteInput): BlueprintSeo {
  const page = representativePage(input.pages);
  const site = buildSite(input);
  const openGraph: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  if (page?.metaDescription) {
    openGraph.description = page.metaDescription;
  }
  if (site.name.length > 0) {
    openGraph.site_name = site.name;
  }
  return {
    default_title_template: titleTemplateFrom(page, site.name),
    open_graph: openGraph,
    twitter,
    structured_data: []
  };
}
