import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

/**
 * Application chrome. The content region owns its own scrolling so the
 * navigation rail and header stay fixed at every window size.
 */
export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base">
      <Sidebar />
      <main id="primary-navigation" className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
