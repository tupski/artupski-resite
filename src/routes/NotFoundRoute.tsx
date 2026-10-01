import { Link } from 'react-router-dom';
import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { EmptyState } from '../components/ui/EmptyState';
import { IconAlert } from '../components/ui/icons';

export function NotFoundRoute() {
  return (
    <PageShell title="Not found" description="This view does not exist.">
      <Panel flush>
        <EmptyState
          icon={<IconAlert size={22} />}
          title="View not found"
          description="The page you requested is not part of this application."
          action={
            <Link to="/" className="text-body text-brand hover:underline">
              Return to Home
            </Link>
          }
        />
      </Panel>
    </PageShell>
  );
}
