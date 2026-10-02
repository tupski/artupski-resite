import { describe, expect, it } from 'vitest';
import { contentTypeFor, normalizeRoot, resolveServePath } from '../serverPathPolicy';

const ROOT = '/Users/x/AppData/clones';

describe('resolveServePath', () => {
  it('maps the root request to index.html', () => {
    expect(resolveServePath('/', ROOT)).toEqual({ ok: true, relative: 'index.html' });
  });

  it('accepts in-root files', () => {
    expect(resolveServePath('/assets/images/x.png', ROOT)).toEqual({
      ok: true,
      relative: 'assets/images/x.png'
    });
    expect(resolveServePath('/pages/about.html', ROOT).ok).toBe(true);
  });

  it('drops query strings and fragments', () => {
    expect(resolveServePath('/index.html?x=1#top', ROOT)).toEqual({
      ok: true,
      relative: 'index.html'
    });
  });

  it('rejects traversal, absolute override, backslash and NUL', () => {
    expect(resolveServePath('/../../etc/passwd', ROOT).ok).toBe(false);
    expect(resolveServePath('/a/../../b', ROOT).ok).toBe(false);
    expect(resolveServePath('/a\\b', ROOT).ok).toBe(false);
    expect(resolveServePath('/a%00b', ROOT).ok).toBe(false);
    expect(resolveServePath('relative/no/slash', ROOT).ok).toBe(false);
  });

  it('rejects malformed percent-encoding', () => {
    expect(resolveServePath('/%E0%A4%A', ROOT).ok).toBe(false);
  });

  it('rejects an encoded traversal', () => {
    expect(resolveServePath('/%2e%2e/etc/passwd', ROOT).ok).toBe(false);
  });
});

describe('normalizeRoot', () => {
  it('normalizes backslashes and trailing slashes', () => {
    expect(normalizeRoot('C:\\data\\clones\\')).toBe('C:/data/clones');
  });
});

describe('contentTypeFor', () => {
  it('maps common clone-tree extensions', () => {
    expect(contentTypeFor('index.html')).toContain('text/html');
    expect(contentTypeFor('css/styles.css')).toContain('text/css');
    expect(contentTypeFor('js/app.js')).toContain('javascript');
    expect(contentTypeFor('assets/images/x.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('assets/fonts/x.woff2')).toBe('font/woff2');
    expect(contentTypeFor('mystery')).toBe('application/octet-stream');
  });
});
