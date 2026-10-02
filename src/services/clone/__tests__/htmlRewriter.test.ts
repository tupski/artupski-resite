import { describe, expect, it } from 'vitest';
import { rewriteHtml } from '../htmlRewriter';
import type { AssetMap, RouteMap } from '../../../types/clone';

const assetMap: AssetMap = {
  'https://example.com/assets/logo.png': 'assets/images/logo_abc12345.png',
  '/clone/assets/style.css': 'assets/style_abc12345.css',
  'https://cdn.example.com/app.js': 'assets/app_abc12345.js'
};
const routeMap: RouteMap = {
  '/about': 'pages/about.html',
  '/': 'index.html'
};

function rewrite(html: string, pagePath = 'index.html'): string {
  return rewriteHtml(html, {
    assetMap,
    routeMap,
    pagePath,
    mockClientPath: 'js/mock-client.js'
  });
}

describe('rewriteHtml', () => {
  it('remaps absolute and root-relative asset URLs to local paths', () => {
    const html = '<img src="https://example.com/assets/logo.png">';
    expect(rewrite(html)).toContain('src="assets/images/logo_abc12345.png"');
  });

  it('rewrites srcset URLs while preserving descriptors', () => {
    const html =
      '<img srcset="https://example.com/assets/logo.png 1x, https://example.com/assets/logo.png 2x">';
    const out = rewrite(html);
    expect(out).toContain('assets/images/logo_abc12345.png 1x');
    expect(out).toContain('assets/images/logo_abc12345.png 2x');
  });

  it('rewrites internal anchors to local pages and keeps hash fragments', () => {
    expect(rewrite('<a href="/about">x</a>')).toContain('href="pages/about.html"');
    expect(rewrite('<a href="/#features">x</a>')).toContain('href="index.html#features"');
  });

  it('marks external links with target=_blank rel=noopener', () => {
    const out = rewrite('<a href="https://other.example/page">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('strips known tracking scripts', () => {
    const html = '<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>';
    expect(rewrite(html)).not.toContain('googletagmanager.com');
  });

  it('removes base href tags', () => {
    const html = '<head><base href="https://example.com/"></head>';
    expect(rewrite(html)).not.toContain('<base');
  });

  it('injects the mock client script relative to the page', () => {
    expect(rewrite('<head></head>')).toContain('<script src="js/mock-client.js"></script>');
    expect(rewrite('<head></head>', 'pages/about.html')).toContain(
      '<script src="../js/mock-client.js"></script>'
    );
  });

  it('is deterministic', () => {
    const html = '<img src="https://example.com/assets/logo.png"><a href="/about">x</a>';
    expect(rewrite(html)).toBe(rewrite(html));
  });
});
