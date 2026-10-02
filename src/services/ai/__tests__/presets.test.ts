import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PRESET,
  getPreset,
  normalizeBaseUrl,
  PROVIDER_PRESETS,
  validateBaseUrl
} from '../presets';

describe('AI provider presets (AI-SPEC.md 2.2)', () => {
  it('includes the documented provider matrix', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual(
      expect.arrayContaining(['openai', 'openrouter', 'ollama', 'lmstudio', 'localai'])
    );
  });

  it('marks local runners as local and keyless', () => {
    const ollama = getPreset('ollama');
    expect(ollama.local).toBe(true);
    expect(ollama.requiresApiKey).toBe(false);
    expect(ollama.baseUrl).toBe('http://localhost:11434/v1');

    const lmstudio = getPreset('lmstudio');
    expect(lmstudio.local).toBe(true);
    expect(lmstudio.baseUrl).toBe('http://localhost:1234/v1');
  });

  it('marks hosted providers as requiring an API key', () => {
    expect(getPreset('openai').requiresApiKey).toBe(true);
    expect(getPreset('openrouter').requiresApiKey).toBe(true);
    expect(getPreset('9router').requiresApiKey).toBe(true);
  });

  it('falls back to the custom descriptor for an unknown id', () => {
    expect(getPreset('does-not-exist')).toBe(CUSTOM_PRESET);
  });
});

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes so paths never double-slash', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1///')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  https://x.test/v1  ')).toBe('https://x.test/v1');
  });
});

describe('validateBaseUrl (security: rejects credential-in-URL)', () => {
  it('accepts absolute http and https URLs', () => {
    expect(validateBaseUrl('https://api.openai.com/v1').valid).toBe(true);
    expect(validateBaseUrl('http://localhost:11434/v1').valid).toBe(true);
  });

  it('rejects an empty or whitespace URL', () => {
    expect(validateBaseUrl('').valid).toBe(false);
    expect(validateBaseUrl('   ').valid).toBe(false);
    expect(validateBaseUrl('http://a.test /v1').valid).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(validateBaseUrl('ftp://x.test/v1').valid).toBe(false);
    expect(validateBaseUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateBaseUrl('javascript:alert(1)').valid).toBe(false);
  });

  it('rejects a URL that embeds credentials', () => {
    const result = validateBaseUrl('https://user:secret@example.com/v1');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/credentials/i);
  });

  it('rejects a relative URL', () => {
    expect(validateBaseUrl('/v1/chat').valid).toBe(false);
  });
});
