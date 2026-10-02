/**
 * Phase 12 path-safety suites - Artupski ReSite
 *
 * Security controls are tested, not merely documented: traversal, absolute
 * paths, Windows drive paths, UNC paths, control characters, and root escape are
 * all exercised directly. ReSite is developed on Windows, so Windows-style paths
 * are tested explicitly.
 */
import { describe, expect, it } from 'vitest';
import {
  isSafeProjectRelativePath,
  pathDepth,
  resolveWithinRoot,
  safeAssetPath,
  safeComponentFileName,
  safeHookFileName,
  slugifyPathSegment,
  toPascalCase
} from '../projectPaths';

describe('isSafeProjectRelativePath', () => {
  it('accepts ordinary relative paths', () => {
    expect(isSafeProjectRelativePath('src/components/Button.tsx')).toBe(true);
    expect(isSafeProjectRelativePath('package.json')).toBe(true);
  });

  it('rejects traversal, absolute, backslash and empty paths', () => {
    expect(isSafeProjectRelativePath('../etc/passwd')).toBe(false);
    expect(isSafeProjectRelativePath('src/../../etc/passwd')).toBe(false);
    expect(isSafeProjectRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeProjectRelativePath('\\server\\share')).toBe(false);
    expect(isSafeProjectRelativePath('src\\components\\Button.tsx')).toBe(false);
    expect(isSafeProjectRelativePath('')).toBe(false);
    expect(isSafeProjectRelativePath('src//Button.tsx')).toBe(false);
  });

  it('rejects Windows drive paths and UNC paths', () => {
    expect(isSafeProjectRelativePath('C:/Windows/System32')).toBe(false);
    expect(isSafeProjectRelativePath('C:\\Windows\\System32')).toBe(false);
    expect(isSafeProjectRelativePath('//server/share/file')).toBe(false);
  });

  it('rejects control characters and NUL', () => {
    expect(isSafeProjectRelativePath('src/\u0000bad.tsx')).toBe(false);
    expect(isSafeProjectRelativePath('src/bad\u0007.tsx')).toBe(false);
  });
});

describe('resolveWithinRoot', () => {
  it('resolves a safe relative path inside a POSIX root', () => {
    expect(resolveWithinRoot('/tmp/project', 'src/main.tsx')).toBe('/tmp/project/src/main.tsx');
  });

  it('resolves a safe relative path inside a Windows drive root', () => {
    expect(resolveWithinRoot('C:/Projects/gen', 'src/main.tsx')).toBe(
      'C:/Projects/gen/src/main.tsx'
    );
    expect(resolveWithinRoot('C:\\Projects\\gen', 'src/main.tsx')).toBe(
      'C:/Projects/gen/src/main.tsx'
    );
  });

  it('refuses any path that escapes the root', () => {
    expect(resolveWithinRoot('/tmp/project', '../project-evil/x')).toBeNull();
    expect(resolveWithinRoot('/tmp/project', 'a/../../x')).toBeNull();
    expect(resolveWithinRoot('/tmp/project', '/etc/passwd')).toBeNull();
    expect(resolveWithinRoot('C:/Projects/gen', 'C:/Windows/x')).toBeNull();
    expect(resolveWithinRoot('/tmp/project', '..\\evil')).toBeNull();
  });

  it('refuses a sibling-prefix escape (not just a string prefix check)', () => {
    // `/tmp/project-evil` shares a string prefix with `/tmp/project`.
    expect(resolveWithinRoot('/tmp/project', '../project-evil/x')).toBeNull();
  });

  it('refuses a non-absolute root', () => {
    expect(resolveWithinRoot('relative/root', 'src/main.tsx')).toBeNull();
  });
});

describe('path derivation helpers', () => {
  it('slugifies hostile segments', () => {
    expect(slugifyPathSegment('A B/C')).toBe('a-b-c');
    expect(slugifyPathSegment('')).toBe('index');
  });

  it('builds a PascalCase identifier safely', () => {
    expect(toPascalCase('About Us')).toBe('AboutUs');
    expect(toPascalCase('/admin/panel')).toBe('AdminPanel');
    expect(toPascalCase('123')).toBe('Page123');
    expect(toPascalCase('')).toBe('Page');
  });

  it('sanitizes component file names to a safe basename', () => {
    expect(safeComponentFileName('../../evil.tsx', 'Button')).toBe('evil.tsx');
    expect(safeComponentFileName('Button.tsx', 'Button')).toBe('Button.tsx');
    expect(safeComponentFileName('C:\\x\\Hero.tsx', 'Hero')).toBe('Hero.tsx');
  });

  it('sanitizes hook file names', () => {
    expect(safeHookFileName('useThing.ts', 'useThing')).toBe('useThing.ts');
    expect(safeHookFileName('../evil.js', 'useThing')).toBe('usething.ts');
  });

  it('produces collision-free asset paths and derives extensions', () => {
    const used = new Set<string>();
    expect(safeAssetPath('assets/logo.png', 'image/png', used)).toBe('public/assets/logo.png');
    expect(safeAssetPath('assets/logo.png', 'image/png', used)).toBe('public/assets/logo-2.png');
    expect(safeAssetPath('assets/unknown', 'image/svg+xml', used)).toBe(
      'public/assets/unknown.svg'
    );
    expect(safeAssetPath('../../evil', 'image/png', used)).toBe('public/assets/evil.png');
  });

  it('counts path depth', () => {
    expect(pathDepth('src/components/Button.tsx')).toBe(3);
    expect(pathDepth('package.json')).toBe(1);
  });
});
