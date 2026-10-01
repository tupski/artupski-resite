import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { EmptyState } from '../components/ui/EmptyState';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { StatusIndicator, type StatusTone } from '../components/ui/StatusIndicator';
import { IconAlert, IconGlobe, IconProjects } from '../components/ui/icons';
import { validateTargetUrl } from '../lib/url';
import { useProjectsStore } from '../stores/projectsStore';
import { getStorageState, storageService } from '../services/storage';
import type { ProjectStatus } from '../types/models';

/**
 * Projects list (UI-SPEC section 2.1 "Recent Projects").
 *
 * Reads real rows from the local database through `projectsStore` ->
 * `projectService` -> repositories. Shows honest loading, empty, error, and
 * not-ready states; there are no placeholder projects.
 */

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  idle: 'neutral',
  scanning: 'brand',
  blueprint_ready: 'brand',
  generating: 'warning',
  completed: 'success',
  error: 'danger'
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  idle: 'Idle',
  scanning: 'Scanning',
  blueprint_ready: 'Blueprint ready',
  generating: 'Generating',
  completed: 'Completed',
  error: 'Error'
};

function formatTimestamp(value: string): string {
  // Stored as SQLite CURRENT_TIMESTAMP (UTC, "YYYY-MM-DD HH:MM:SS").
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function ProjectsRoute() {
  const projects = useProjectsStore((state) => state.projects);
  const status = useProjectsStore((state) => state.status);
  const error = useProjectsStore((state) => state.error);
  const mutating = useProjectsStore((state) => state.mutating);
  const loadProjects = useProjectsStore((state) => state.loadProjects);
  const createProject = useProjectsStore((state) => state.createProject);
  const deleteProject = useProjectsStore((state) => state.deleteProject);

  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Storage state is not part of the store, so subscribe to it directly to keep
  // the status indicator honest while initialization is in flight.
  const storageState = useSyncExternalStore(
    (onStoreChange) => storageService.onStateChange(onStoreChange),
    getStorageState
  );

  const validation = validateTargetUrl(targetUrl);
  const showUrlError = touched && targetUrl.trim().length > 0 && !validation.valid;
  const canSubmit = validation.valid && name.trim().length > 0 && !mutating;

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setFormError(null);
    if (!validation.valid) {
      return;
    }
    const created = await createProject({ name, targetUrl: validation.url });
    if (!created) {
      setFormError('The project could not be created. Check that local storage is available.');
      return;
    }
    setName('');
    setTargetUrl('');
    setTouched(false);
  }

  const notReady = status === 'error' && storageState !== 'ready';

  return (
    <PageShell title="Projects" description="Reverse-engineering projects stored on this machine.">
      <div className="flex flex-col gap-4">
        <Panel
          title="New project"
          actions={
            <StatusIndicator
              tone={storageStateTone(storageState)}
              label={storageStateLabel(storageState)}
              pulse={storageState === 'initializing'}
            />
          }
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Project name"
                placeholder="Marketing site"
                value={name}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                disabled={mutating}
              />
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
                error={showUrlError ? validation.message : null}
                disabled={mutating}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-text-muted">
                {storageService.getDatabaseLocation()
                  ? `Stored at ${storageService.getDatabaseLocation()}`
                  : 'Scanning and blueprint generation arrive in later phases.'}
              </p>
              <Button type="submit" variant="primary" disabled={!canSubmit}>
                {mutating ? 'Saving…' : 'Create project'}
              </Button>
            </div>
            {formError ? (
              <p role="alert" className="text-caption text-danger">
                {formError}
              </p>
            ) : null}
          </form>
        </Panel>

        <Panel
          title="All projects"
          actions={
            projects.length > 0 ? (
              <span className="text-caption text-text-muted">
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </span>
            ) : null
          }
        >
          {renderBody()}
        </Panel>
      </div>
    </PageShell>
  );

  function renderBody() {
    if (status === 'loading' || status === 'idle') {
      return (
        <ul className="flex flex-col" aria-busy="true" aria-label="Loading projects">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="flex items-center gap-3 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
            >
              <span className="h-4 w-40 animate-pulse rounded-sm bg-surface-elevated" />
              <span className="h-4 flex-1 animate-pulse rounded-sm bg-surface-elevated" />
            </li>
          ))}
        </ul>
      );
    }

    if (status === 'error') {
      if (notReady) {
        return (
          <EmptyState
            icon={<IconAlert size={22} />}
            title="Local storage is unavailable"
            description={
              error?.message ??
              'The local database could not be opened, so projects cannot be listed or created.'
            }
            action={
              <Button variant="secondary" onClick={() => void loadProjects()}>
                Retry
              </Button>
            }
          />
        );
      }
      return (
        <EmptyState
          icon={<IconAlert size={22} />}
          title="Could not load projects"
          description={error?.message ?? 'An unexpected storage error occurred while reading projects.'}
          action={
            <Button variant="secondary" onClick={() => void loadProjects()}>
              Retry
            </Button>
          }
        />
      );
    }

    if (projects.length === 0) {
      return (
        <EmptyState
          icon={<IconProjects size={22} />}
          title="No projects yet"
          description="Create your first project above by naming it and entering a target website URL."
        />
      );
    }

    return (
      <ul className="flex flex-col">
        {projects.map((project) => (
          <li
            key={project.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-body text-text-primary">{project.name}</span>
              <span className="flex items-center gap-1.5 truncate font-mono text-code text-text-muted">
                <IconGlobe size={13} />
                <span className="truncate">{project.targetUrl}</span>
              </span>
            </div>
            <span className="text-caption text-text-muted">{formatTimestamp(project.updatedAt)}</span>
            <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>
            <Button
              variant="danger"
              size="sm"
              disabled={mutating}
              aria-label={`Delete project ${project.name}`}
              onClick={() => void deleteProject(project.id)}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    );
  }
}

function storageStateTone(state: ReturnType<typeof getStorageState>): StatusTone {
  switch (state) {
    case 'ready':
      return 'success';
    case 'error':
      return 'danger';
    case 'initializing':
      return 'active';
    default:
      return 'idle';
  }
}

function storageStateLabel(state: ReturnType<typeof getStorageState>): string {
  switch (state) {
    case 'ready':
      return 'Local storage ready';
    case 'error':
      return 'Local storage unavailable';
    case 'initializing':
      return 'Opening local storage…';
    default:
      return 'Local storage not initialized';
  }
}
