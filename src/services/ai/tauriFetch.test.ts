import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAiFetchForTests, resolveAiFetch } from './tauriFetch';

/**
 * The resolver must hand back a usable `fetch` outside the desktop shell so the
 * AI provider keeps working in the browser preview and tests (inside Tauri it
 * returns the plugin fetch, exercised manually in the desktop shell).
 */
describe('resolveAiFetch', () => {
  afterEach(() => {
    resetAiFetchForTests();
    vi.unstubAllGlobals();
  });

  it('falls back to the ambient fetch outside the Tauri runtime', async () => {
    const calls: string[] = [];
    const fake = vi.fn(async (input: string) => {
      calls.push(input);
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fake);

    const fetchImpl = await resolveAiFetch();
    const response = await fetchImpl('https://example.com/v1/models');

    expect(calls).toEqual(['https://example.com/v1/models']);
    expect(response.status).toBe(200);
  });

  it('memoizes the resolved fetch', async () => {
    const fake = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fake);

    const first = await resolveAiFetch();
    const second = await resolveAiFetch();
    expect(second).toBe(first);
  });
});
