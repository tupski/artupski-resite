import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { EmptyState } from '../components/ui/EmptyState';
import { IconProjects } from '../components/ui/icons';

/**
 * Projects list. Phase 1 has no persistence layer (SQLite arrives in a later
 * phase), so this renders an honest empty state rather than fabricated rows.
 */
export function ProjectsRoute() {
  return (
    <PageShell title="Projects" description="Reverse-engineering projects stored on this machine.">
      <Panel flush>
        <EmptyState
          icon={<IconProjects size={22} />}
          title="No projects yet"
          description="Projects you create will appear here once local storage is introduced. Start one from the Home screen by entering a URL."
        />
      </Panel>
    </PageShell>
  );
}
