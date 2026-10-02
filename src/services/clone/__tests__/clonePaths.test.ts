import { describe, expect, it } from 'vitest';
import {
  assetDirForType,
  assetPathFor,
  extensionFromUrl,
  isSafeRelativePath,
  pagePathForUrl,
  relativeFromCss,
  relativeFromPage,
  slugifySegment
} from '../clonePaths';

describe('clonePaths', () => {
  it('maps the root page to index.html and secondary routes under pages/', () => {
    expect(pagePathForUrl('https://example.com/', 'https://example.com')).toBe('index.html');
    expect(pagePathForUrl('https://example.com/about', 'https://example.com')).toBe(
      'pages/about.html'
    );
    expect(pagePathForUrl('https://example.com/pricing/plans', 'https://example.com')).toBe(
      'pages/pricing_plans.html'
    );
  });

  it('never lets a traversal segment escape the clone root', () => {
    const path = pagePathForUrl('https://example.com/../../etc/passwd', 'https://example.com');
    expect(path.startsWith('pages/')).toBe(true);
    expect(path).not.toContain('..');
    expect(isSafeRelativePath(path)).toBe(true);
  });

  it('derives a safe extension from the URL', () => {
    expect(extensionFromUrl('https://example.com/a/logo.svg')).toBe('svg');
    expect(extensionFromUrl('https://example.com/a/style.css?v=1')).toBe('css');
    expect(extensionFromUrl('https://example.com/no-extension')).toBe('');
  });

  it('routes asset types to the documented subdirectories', () => {
    expect(assetDirForType('image')).toBe('assets/images');
    expect(assetDirForType('font')).toBe('assets/fonts');
    expect(assetDirForType('video')).toBe('assets/media');
    expect(assetDirForType('stylesheet')).toBe('assets');
  });

  it('produces a content-hashed, collision-free asset path', () => {
    const path = assetPathFor('https://example.com/img/logo.svg', 'image', 'abcdef0123456789');
    expect(path).toBe('assets/images/logo_abcdef01.svg');
    expect(isSafeRelativePath(path)).toBe(true);
  });

  it('slugifies hostile segments', () => {
    expect(slugifySegment('A B/C')).toBe('a-b-c');
    expect(slugifySegment('')).toBe('index');
  });

  it('computes page-relative references by depth', () => {
    expect(relativeFromPage('index.html', 'assets/x.png')).toBe('assets/x.png');
    expect(relativeFromPage('pages/about.html', 'assets/x.png')).toBe('../assets/x.png');
  });

  it('computes stylesheet-relative references', () => {
    expect(relativeFromCss('assets/x.png')).toBe('../assets/x.png');
    expect(relativeFromCss('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('rejects unsafe relative paths', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('a/../b')).toBe(false);
    expect(isSafeRelativePath('a\\b')).toBe(false);
    expect(isSafeRelativePath('assets/images/x.png')).toBe(true);
  });
});
