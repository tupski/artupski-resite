import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '../../app/navigation';
import { useUiStore } from '../../stores/uiStore';
import { cn } from '../../lib/cn';

/**
 * Primary application navigation.
 *
 * A persistent vertical rail: familiar for desktop tools, keyboard reachable,
 * with a clear active state. Collapses to icons on narrow windows.
 */
export function Sidebar() {
  const sidebarExpanded = useUiStore((state) => state.sidebarExpanded);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex h-full flex-col border-r border-border-subtle bg-surface',
        'transition-[width] duration-150',
        sidebarExpanded ? 'w-56' : 'w-14'
      )}
    >
      <div className="flex h-11 items-center justify-center border-b border-border-subtle px-2">
        {sidebarExpanded ? (
          <img
            src="/logo-horizontal.png"
            alt="Artupski ReSite"
            className="h-6 w-auto max-w-full object-contain"
          />
        ) : (
          <img
            src="/app-icon.png"
            alt="Artupski ReSite"
            className="h-6 w-6 object-contain"
          />
        )}
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 p-1.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                title={sidebarExpanded ? undefined : item.label}
                aria-label={item.label}
                className={({ isActive }) =>
                  cn(
                    'group flex h-8 items-center gap-2.5 rounded px-2 text-body',
                    'transition-colors duration-100',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus',
                    isActive
                      ? 'bg-surface-elevated text-text-primary font-medium'
                      : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center',
                        isActive ? 'text-brand' : 'text-text-muted group-hover:text-text-secondary'
                      )}
                    >
                      <Icon />
                    </span>
                    {sidebarExpanded ? <span className="truncate">{item.label}</span> : null}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border-subtle p-1.5">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={sidebarExpanded}
          aria-controls="primary-navigation"
          className="flex h-7 w-full items-center justify-center rounded text-caption text-text-muted hover:bg-surface-elevated hover:text-text-secondary"
          title={sidebarExpanded ? 'Collapse navigation' : 'Expand navigation'}
        >
          {sidebarExpanded ? 'Collapse' : '»'}
        </button>
      </div>
    </nav>
  );
}
