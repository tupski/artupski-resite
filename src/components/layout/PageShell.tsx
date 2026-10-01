import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';

export interface PageShellProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** Standard page frame: window header plus a scrollable content region. */
export function PageShell({ title, description, children }: PageShellProps) {
  return (
    <>
      <AppHeader title={title} description={description} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-4">{children}</div>
      </div>
    </>
  );
}
