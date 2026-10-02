import { describe, expect, it } from 'vitest';
import { rewriteCss } from '../cssRewriter';
import type { AssetMap } from '../../../types/clone';

const assetMap: AssetMap = {
  '/clone/assets/logo.svg': 'assets/images/logo_abc12345.svg',
  'https://example.com/font.woff2': 'assets/fonts/font_abc12345.woff2'
};

describe('rewriteCss', () => {
  it('remaps url() references relative to the stylesheet', () => {
    const out = rewriteCss('.hero { background: url("/clone/assets/logo.svg"); }', {
      assetMap,
      cssPath: 'css/styles.css'
    });
    expect(out).toContain('url("../assets/images/logo_abc12345.svg")');
  });

  it('remaps absolute font URLs', () => {
    const out = rewriteCss('@font-face { src: url(https://example.com/font.woff2); }', {
      assetMap,
      cssPath: 'css/styles.css'
    });
    // A bare url(...) is re-emitted quoted; assert on the mapped path itself.
    expect(out).toContain('../assets/fonts/font_abc12345.woff2');
    expect(out).not.toContain('https://example.com/font.woff2');
  });

  it('collapses duplicate @charset declarations', () => {
    const out = rewriteCss('@charset "utf-8";\n@charset "utf-8";\nbody{}', {
      assetMap,
      cssPath: 'css/styles.css'
    });
    expect(out.match(/@charset/g)?.length).toBe(1);
  });

  it('leaves data URLs and unknown references untouched', () => {
    const css = 'background: url(data:image/png;base64,AAAA); x: url(/unknown.png);';
    const out = rewriteCss(css, { assetMap, cssPath: 'css/styles.css' });
    expect(out).toContain('url(data:image/png;base64,AAAA)');
    expect(out).toContain('url(/unknown.png)');
  });
});
