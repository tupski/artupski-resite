import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useThemeSync } from './useThemeSync';
import { createEvent, eventBus } from '../services/infra/eventBus';
import { logger } from '../services/infra/logger';

const APP_VERSION = '0.1.0';

/**
 * Application root. Applies the theme, announces startup through the event bus,
 * and mounts the router. Business logic lives in services/stores, not here.
 */
export function App() {
  useThemeSync();

  useEffect(() => {
    eventBus.emit(createEvent('app.started', { version: APP_VERSION }));
    logger.info('Artupski ReSite started', { version: APP_VERSION });
  }, []);

  return <RouterProvider router={router} />;
}
