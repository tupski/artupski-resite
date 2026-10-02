import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// This setup is shared by the jsdom (DOM) tier. The opt-in AI engine E2E runs
// under the `node` environment (`@vitest-environment node`), where `window` and
// React Testing Library are unavailable; the DOM-only setup is skipped there so
// the same global setup file can serve both tiers without weakening jsdom tests.
const hasDom = typeof window !== 'undefined';

if (hasDom) {
  // jsdom does not implement matchMedia; the theme controller relies on it.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  }

  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  });
}
