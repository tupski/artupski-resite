import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useThemeSync } from './useThemeSync';
import { createEvent, eventBus } from '../services/infra/eventBus';
import { logger } from '../services/infra/logger';
import { initializeStorage } from '../services/storage';
import { initializeBrowserRuntime } from '../services/browser';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { ToastRegion, ToastRegionProvider } from '../components/common/ToastRegion';
import { startErrorBridge } from '../components/common/errorBridge';

const APP_VERSION = '0.1.0';

/**
 * Application root. Applies the theme, announces startup through the event bus,
 * kicks off local storage initialization (non-blocking), installs the global
 * error guards, and mounts the routed tree inside the error boundary.
 *
 * `ToastRegion` lives here (as a sibling of the router) so a render fault in the
 * routed tree cannot unmount the very chrome that reports it. `AppLayout` also
 * renders a `ToastRegion`; the region is context-guarded so only the outermost
 * instance actually renders (no double-mount, no duplicated toasts).
 */
export function App() {
  useThemeSync();

  useEffect(() => {
    eventBus.emit(createEvent('app.started', { version: APP_VERSION }));
    logger.info('Artupski ReSite started', { version: APP_VERSION });

    // Non-blocking: the UI stays usable while storage opens and migrates, and
    // failures are surfaced as the storage `error` state rather than crashing.
    void initializeStorage();

    // Non-blocking browser-runtime detection (Phase 3). Outside the Tauri shell
    // this resolves to `null` and does nothing; a missing browser becomes an
    // honest `browser.missing` event, never a crash or a blocking spinner.
    void initializeBrowserRuntime();

    // Bridge worker failures and unhandled global exceptions into notices.
    const stopErrorBridge = startErrorBridge();
    return () => {
      stopErrorBridge();
    };
  }, []);

  return (
    <ErrorBoundary>
      <ToastRegion />
      <ToastRegionProvider>
        <RouterProvider router={router} />
      </ToastRegionProvider>
    </ErrorBoundary>
  );
}
