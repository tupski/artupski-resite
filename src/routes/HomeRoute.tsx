import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { IconArrowRight, IconProjects } from '../components/ui/icons';
import { validateTargetUrl } from '../lib/url';
import { useScanStore } from '../stores/scanStore';

/**
 * Initial workspace (UI-SPEC section 2.1 subset).
 *
 * Phase 1 provides URL entry with validation and a real empty state. Scanning
 * itself is not implemented, so the primary action transitions to the Scan
 * route rather than faking progress.
 */
export function HomeRoute() {
  const navigate = useNavigate();
  const targetUrl = useScanStore((state) => state.targetUrl);
  const setTargetUrl = useScanStore((state) => state.setTargetUrl);

  const [touched, setTouched] = useState(false);

  const validation = validateTargetUrl(targetUrl);
  const showError = touched && targetUrl.trim().length > 0 && !validation.valid;
  const canSubmit = validation.valid;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!validation.valid) {
      return;
    }
    navigate('/scan');
  }

  return (
    <PageShell
      title="Home"
      description="Reverse-engineer a website into a blueprint, then a full project."
    >
      <div className="flex flex-col gap-4">
        <Panel
          title="New project"
          actions={<Badge tone="warning">Scanner available in a later phase</Badge>}
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
            <Input
              label="Target website URL"
              placeholder="https://example.com"
              value={targetUrl}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              inputClassName="font-mono text-code"
              onChange={(event) => setTargetUrl(event.target.value)}
              onBlur={() => setTouched(true)}
              error={showError ? validation.message : null}
              hint="Protocol defaults to https:// when omitted."
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-text-muted">
                Configure crawl depth, pages, and viewports on the Scan screen.
              </p>
              <Button type="submit" variant="primary" disabled={!canSubmit}>
                Configure scan
                <IconArrowRight size={14} />
              </Button>
            </div>
          </form>
        </Panel>

        <Panel title="Recent projects" flush>
          <EmptyState
            icon={<IconProjects size={22} />}
            title="No projects yet"
            description="Enter a website URL to start your first reverse-engineering project."
          />
        </Panel>
      </div>
    </PageShell>
  );
}
