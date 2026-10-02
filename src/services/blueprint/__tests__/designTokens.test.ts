/**
 * Design-token extraction/normalization tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 11.
 */
import { describe, expect, it } from 'vitest';
import { extractDesignTokens, MAX_TOKENS_PER_RECORD } from '../designTokens';
import { model, node } from './fixtures';

describe('extractDesignTokens', () => {
  it('maps CSS custom properties to semantic colour keys with observations', () => {
    const result = extractDesignTokens([
      model({ cssVariables: { '--primary': '#0ea5e9', '--background': '#ffffff' } })
    ]);
    expect(result.designSystem.colors.primary).toBe('#0ea5e9');
    expect(result.designSystem.colors.background).toBe('#ffffff');
    expect(result.observedCount).toBeGreaterThan(0);
  });

  it('keeps a real colour scale grouped under one key', () => {
    const result = extractDesignTokens([
      model({
        cssVariables: {
          '--primary-50': '#f0f9ff',
          '--primary-500': '#0ea5e9',
          '--primary-900': '#0c4a6e'
        }
      })
    ]);
    const primary = result.designSystem.colors.primary;
    expect(typeof primary).toBe('object');
    expect((primary as Record<string, string>)['500']).toBe('#0ea5e9');
  });

  it('does NOT invent scale steps that were not observed', () => {
    const result = extractDesignTokens([model({ cssVariables: { '--primary': '#0ea5e9' } })]);
    expect(result.designSystem.colors.primary).toBe('#0ea5e9');
  });

  it('keeps visually-similar-but-distinct colours separate (no merging)', () => {
    const result = extractDesignTokens([
      model({
        nodes: [
          node({ id: 'a', tag: 'div', styles: { backgroundColor: '#ffffff' } }),
          node({ id: 'b', tag: 'div', styles: { backgroundColor: '#fff' } })
        ]
      })
    ]);
    const values = Object.values(result.designSystem.colors).flatMap((entry) =>
      typeof entry === 'string' ? [entry] : Object.values(entry)
    );
    expect(values).toContain('#ffffff');
    expect(values).toContain('#fff');
  });

  it('extracts font families into sans/mono buckets from observed stacks', () => {
    const result = extractDesignTokens([
      model({
        nodes: [
          node({
            id: 'a',
            tag: 'body',
            styles: { fontFamily: 'Inter, -apple-system, sans-serif' }
          }),
          node({ id: 'b', tag: 'code', styles: { fontFamily: 'JetBrains Mono, monospace' } })
        ]
      })
    ]);
    expect(result.designSystem.typography.font_sans).toContain('Inter');
    expect(result.designSystem.typography.font_mono).toContain('JetBrains Mono');
  });

  it('maps observed font sizes to named steps and preserves conflicting stacks', () => {
    const result = extractDesignTokens([
      model({
        nodes: [
          node({
            id: 'a',
            tag: 'h1',
            styles: { fontSize: '2.25rem', fontFamily: 'Inter, sans-serif' }
          }),
          node({
            id: 'b',
            tag: 'p',
            styles: { fontSize: '1rem', fontFamily: 'Roboto, sans-serif' }
          })
        ]
      })
    ]);
    expect(result.designSystem.typography.font_sizes['4xl']).toBe('2.25rem');
    expect(result.designSystem.typography.font_sizes.base).toBe('1rem');
    // Both conflicting stacks are preserved as candidates.
    expect(result.designSystem.typography.font_sans).toEqual(
      expect.arrayContaining(['Inter', 'Roboto'])
    );
  });

  it('derives spacing from observed margin/padding/gap values', () => {
    const result = extractDesignTokens([
      model({
        nodes: [
          node({
            id: 'a',
            tag: 'div',
            styles: { padding: '16px 24px', margin: '8px', gap: '16px' }
          })
        ]
      })
    ]);
    const spacing = Object.values(result.designSystem.spacing);
    expect(spacing).toContain('16px');
    expect(spacing).toContain('24px');
    expect(spacing).toContain('8px');
  });

  it('extracts radii and shadows and caps cardinality', () => {
    const result = extractDesignTokens([
      model({
        nodes: [
          node({
            id: 'a',
            tag: 'div',
            styles: { borderRadius: '0.375rem', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }
          })
        ]
      })
    ]);
    expect(Object.values(result.designSystem.radii)).toContain('0.375rem');
    expect(Object.keys(result.designSystem.shadows).length).toBeGreaterThan(0);
    expect(Object.keys(result.designSystem.spacing).length).toBeLessThanOrEqual(
      MAX_TOKENS_PER_RECORD
    );
  });

  it('produces an empty colours record (with a limitation) when no evidence exists', () => {
    const result = extractDesignTokens([model({})]);
    expect(result.designSystem.colors).toEqual({});
    expect(
      result.designSystem.typography.font_sans.length +
        result.designSystem.typography.font_mono.length
    ).toBe(0);
  });

  it('is deterministic for identical evidence', () => {
    const first = extractDesignTokens([model({ cssVariables: { '--a': '#111', '--b': '#222' } })]);
    const second = extractDesignTokens([model({ cssVariables: { '--a': '#111', '--b': '#222' } })]);
    expect(JSON.stringify(first.designSystem)).toBe(JSON.stringify(second.designSystem));
  });
});
