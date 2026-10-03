import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ToastRegion } from '../common/ToastRegion';

/**
 * Application chrome. The content region owns its own scrolling so the
 * navigation rail and header stay fixed at every window size.
 *
 * `ToastRegion` is rendered here so the shell owns the notice chrome; when the
 * region is already hosted by an ancestor (the `App` root), it defers and does
 * not double-mount.
 */
export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base">
      <Sidebar />
      <main id="primary-navigation" className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      <ToastRegion />
    </div>
  );
}
