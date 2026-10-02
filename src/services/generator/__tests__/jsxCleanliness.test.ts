import { describe, expect, it } from 'vitest';
import {
  assessCleanliness,
  declaresComponent,
  evaluateGeneratedComponent,
  hasBalancedDelimiters,
  hasUnusedImports,
  maxBraceDepth,
  optimizeJsx,
  validateTsxStructure
} from '../jsxCleanliness';

const CLEAN = `interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary';
}

export function Button({ label, variant = 'primary' }: ButtonProps) {
  const classes =
    variant === 'primary'
      ? 'bg-sky-500 text-white hover:bg-sky-600 px-4 py-2 rounded-md'
      : 'bg-slate-100 text-slate-900 px-4 py-2 rounded-md';
  return (
    <button type="button" className={classes}>
      {label}
    </button>
  );
}
`;

describe('validateTsxStructure (Phase 11 structural gate)', () => {
  it('accepts a clean, well-formed component (A1)', () => {
    const result = validateTsxStructure(CLEAN, 'Button');
    expect(result.clean).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects an empty component', () => {
    expect(validateTsxStructure('', 'Button').violations).toContain('EMPTY_CODE');
  });

  it('rejects an invalid identifier', () => {
    expect(validateTsxStructure(CLEAN, 'button').violations).toContain('INVALID_IDENTIFIER');
  });

  it('rejects unbalanced delimiters', () => {
    const broken = 'export function Button() { return <div>; ';
    expect(validateTsxStructure(broken, 'Button').violations).toContain('UNBALANCED_DELIMITERS');
  });

  it('rejects excessive brace nesting', () => {
    const deep = `export function Button() { return <div>${'{'.repeat(60)}${'}'.repeat(60)}</div>; }`;
    expect(validateTsxStructure(deep, 'Button').violations).toContain('EXCESSIVE_NESTING');
  });

  it('rejects a missing component declaration', () => {
    const noDecl = 'const other = 1;';
    expect(validateTsxStructure(noDecl, 'Button').violations).toContain(
      'MISSING_COMPONENT_DECLARATION'
    );
  });

  it.each([
    ['SCRIPT_TAG', 'export function X() { return <script>alert(1)</script>; }'],
    ['DANGEROUS_HTML', 'export function X() { return <div dangerouslySetInnerHTML={{}} />; }'],
    ['EVAL_USAGE', 'export function X() { eval("1"); return <div />; }'],
    ['FUNCTION_CONSTRUCTOR', 'export function X() { new Function("return 1"); return <div />; }'],
    ['REQUIRE_USAGE', 'export function X() { require("fs"); return <div />; }'],
    ['DYNAMIC_IMPORT', 'export function X() { import("x"); return <div />; }'],
    ['PROCESS_ENV', 'export function X() { return <div>{process.env.SECRET}</div>; }'],
    ['STYLE_TAG', 'export function X() { return <style>.a{}</style>; }']
  ])('rejects unsafe construct %s', (code, source) => {
    expect(validateTsxStructure(source, 'X').violations).toContain(code);
  });

  it('hasBalancedDelimiters ignores delimiters inside strings? (documents behavior)', () => {
    // The scan is structural; balanced code passes and broken code fails.
    expect(hasBalancedDelimiters('{[]()}')).toBe(true);
    expect(hasBalancedDelimiters('{(})')).toBe(false);
  });

  it('maxBraceDepth counts the deepest brace run', () => {
    expect(maxBraceDepth('{{}}')).toBe(2);
  });

  it('declaresComponent accepts both function and arrow declarations', () => {
    expect(declaresComponent('function Button() {}', 'Button')).toBe(true);
    expect(declaresComponent('const Button = () => null;', 'Button')).toBe(true);
    expect(declaresComponent('const Other = () => null;', 'Button')).toBe(false);
  });
});

describe('assessCleanliness (AI-slop rejection, A3)', () => {
  it('accepts the clean fixture', () => {
    expect(assessCleanliness(CLEAN).clean).toBe(true);
  });

  it.each([
    ['CONVERSATIONAL_FILLER', 'Here is the component:\nexport function X() { return <div />; }'],
    ['MARKDOWN_FENCE', '```tsx\nexport function X() { return <div />; }\n```'],
    ['TODO_COMMENT', 'export function X() { /* ok */ return <div />; } // TODO finish'],
    ['BLOCK_COMMENT', 'export function X() { /* note */ return <div />; }'],
    ['ANY_TYPE', 'export function X(props: any) { return <div />; }'],
    ['TS_IGNORE', '// @ts-ignore\nexport function X() { return <div />; }'],
    ['CONSOLE_CALL', 'export function X() { console.log("x"); return <div />; }'],
    ['DEBUGGER', 'export function X() { debugger; return <div />; }'],
    ['ALERT_CALL', 'export function X() { alert("x"); return <div />; }'],
    ['EMPTY_HANDLER', 'export function X() { return <button onClick={() => {}} />; }']
  ])('detects %s', (code, source) => {
    expect(assessCleanliness(source).violations).toContain(code);
  });

  it('detects unused imports', () => {
    const src = `import { useMemo } from 'react';\nexport function X() { return <div />; }`;
    expect(hasUnusedImports(src)).toBe(true);
    expect(assessCleanliness(src).violations).toContain('UNUSED_IMPORT');
  });

  it('does not flag used imports (default, named, aliased, namespace)', () => {
    expect(
      hasUnusedImports(`import React from 'react';\nexport const X = () => <React.Fragment />;`)
    ).toBe(false);
    expect(
      hasUnusedImports(
        `import { useState } from 'react';\nexport function X() { useState(); return <div />; }`
      )
    ).toBe(false);
    expect(
      hasUnusedImports(
        `import { useMemo as memo } from 'react';\nexport function X() { memo(); return <div />; }`
      )
    ).toBe(false);
    expect(
      hasUnusedImports(`import * as R from 'react';\nexport const X = () => <R.Fragment />;`)
    ).toBe(false);
  });
});

describe('optimizeJsx (deterministic normalizer)', () => {
  it('sorts imports and ends the file with a single newline', () => {
    const src = `import { z } from 'z';\nimport { a } from 'a';\n\nexport function X() { return <div />; }\n\n\n`;
    const out = optimizeJsx(src);
    expect(out.startsWith("import { a } from 'a';\nimport { z } from 'z';\n")).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.includes('\n\n\n')).toBe(false);
  });

  it('is idempotent', () => {
    const once = optimizeJsx(CLEAN);
    expect(optimizeJsx(once)).toBe(once);
  });

  it('does not alter the body logic', () => {
    expect(optimizeJsx(CLEAN)).toContain("variant === 'primary'");
  });
});

describe('evaluateGeneratedComponent (combined gate, A3)', () => {
  it('returns optimized code for a clean component', () => {
    const result = evaluateGeneratedComponent(CLEAN, 'Button');
    expect(result.clean).toBe(true);
    expect(result.optimized).toBeDefined();
    expect(result.optimized).toContain('export function Button');
  });

  it('merges structure and cleanliness violations', () => {
    const src = 'export function X(props: any) { return <div>; ';
    const result = evaluateGeneratedComponent(src, 'X');
    expect(result.clean).toBe(false);
    expect(result.violations).toContain('UNBALANCED_DELIMITERS');
    expect(result.violations).toContain('ANY_TYPE');
    expect(result.optimized).toBeUndefined();
  });
});
