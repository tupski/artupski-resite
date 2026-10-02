import { describe, expect, it } from 'vitest';
import { ComponentOutputSchema } from '../componentSchema';
import { MAX_COMPONENT_CODE_CHARS } from '../../../types/componentSynth';

describe('ComponentOutputSchema (structured-output contract)', () => {
  it('accepts a well-formed output', () => {
    const result = ComponentOutputSchema.safeParse({
      componentId: 'cmp_button_primary',
      name: 'Button',
      fileName: 'Button.tsx',
      code: 'export function Button() { return <button />; }'
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-PascalCase name', () => {
    const result = ComponentOutputSchema.safeParse({
      componentId: 'x',
      name: 'button',
      fileName: 'button.tsx',
      code: 'x'
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty code', () => {
    const result = ComponentOutputSchema.safeParse({
      componentId: 'x',
      name: 'Button',
      fileName: 'Button.tsx',
      code: ''
    });
    expect(result.success).toBe(false);
  });

  it('rejects oversized code', () => {
    const result = ComponentOutputSchema.safeParse({
      componentId: 'x',
      name: 'Button',
      fileName: 'Button.tsx',
      code: 'a'.repeat(MAX_COMPONENT_CODE_CHARS + 1)
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const result = ComponentOutputSchema.safeParse({
      componentId: 'x',
      name: 'Button',
      fileName: 'Button.tsx',
      code: 'x',
      commentary: 'Here is your component'
    });
    expect(result.success).toBe(false);
  });
});
