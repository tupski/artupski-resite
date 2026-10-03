import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusIndicator } from '../components/ui/StatusIndicator';
import { IconAlert, IconProjects } from '../components/ui/icons';
import { TechnologyPanel } from '../components/scan/TechnologyPanel';
import { ViewportPreview } from '../components/scan/ViewportPreview';
import { BlueprintPanel } from '../components/blueprint/BlueprintPanel';
import { PagesTable } from '../components/project/PagesTable';
import { AssetList } from '../components/project/AssetList';
import { useProjectDetailStore } from '../stores/projectDetailStore';
import { useTechnologyStore } from '../stores/technologyStore';
import { useResponsiveStore } from '../stores/responsiveStore';
import { useCloneStore } from '../stores/cloneStore';
import { useBlueprintStore } from '../stores/blueprintStore';
import type { Scan } from '../types/models';
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  SCAN_RECORD_STATUS_LABEL,
  SCAN_RECORD_STATUS_TONE,
  formatTimestamp
} from '../components/project/format';

/**
 * Project detail (read-only review) - Artupski ReSite
 *
 * A completed project cannot be edited or re-scanned, so this is the only way
 * to revisit what a scan produced. Every panel reads the persisted database -
 * nothing is fabricated and no mutation is offered: the Blueprint and clone
 * panels are shown read-only (no generate actions).
 *
 * The per-scan datasets (technologies, responsive captures, clone assets,
 * Blueprint) are loaded through their existing stores, exactly as the Scan
 * screen does, keyed on the active scan.
 */

type DetailTab = 'overview' | 'pages' | 'technologies' | 'responsive' | 'assets' | 'blueprint';

const TABS: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'pages', label: 'Pages' },
  { id: 'technologies', label: 'Technologies' },
  { id: 'responsive', label: 'Responsive' },
  { id: 'assets', label: 'Assets' },
  { id: 'blueprint', label: 'Blueprint' }
];

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-border-subtle bg-base px-3 py-2">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="font-mono text-code text-text-primary">{value}</dd>
    </div>
  );
}

function scanDuration(scan: Scan): string {
  if (!scan.completedAt) {
    return '—';
  }
  const start = new Date(scan.startedAt.includes('T') ? scan.startedAt : `${scan.startedAt.replace(' ', 'T')}Z`);
  const end = new Date(scan.completedAt.includes('T') ? scan.completedAt : `${scan.completedAt.replace(' ', 'T')}Z`);
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function ProjectDetailRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>('overview');

  const status = useProjectDetailStore((state) => state.status);
  const error = useProjectDetailStore((state) => state.error);
  const project = useProjectDetailStore((state) => state.project);
  const scans = useProjectDetailStore((state) => state.scans);
  const activeScanId = useProjectDetailStore((state) => state.activeScanId);
  const pages = useProjectDetailStore((state) => state.pages);
  const pagesLoading = useProjectDetailStore((state) => state.pagesLoading);
  const pagesError = useProjectDetailStore((state) => state.pagesError);
  const load = useProjectDetailStore((state) => state.load);
  const selectScan = useProjectDetailStore((state) => state.selectScan);

  const detections = useTechnologyStore((state) => state.detections);
  const detectionsLoading = useTechnologyStore((state) => state.loading);
  const detectionsError = useTechnologyStore((state) => state.error);
  const detectionsPartial = useTechnologyStore((state) => state.partial);
  const loadDetections = useTechnologyStore((state) => state.loadForScan);
  const clearDetections = useTechnologyStore((state) => state.clear);

  const viewportCaptures = useResponsiveStore((state) => state.captures);
  const viewportLoading = useResponsiveStore((state) => state.loading);
  const viewportError = useResponsiveStore((state) => state.error);
  const loadViewportCaptures = useResponsiveStore((state) => state.loadForScan);
  const clearViewportCaptures = useResponsiveStore((state) => state.clear);

  const cloneAssets = useCloneStore((state) => state.assets);
  const cloneLoading = useCloneStore((state) => state.loading);
  const cloneError = useCloneStore((state) => state.error);
  const loadCloneAssets = useCloneStore((state) => state.loadForScan);
  const clearClone = useCloneStore((state) => state.clear);

  const blueprintStatus = useBlueprintStore((state) => state.status);
  const blueprintRecord = useBlueprintStore((state) => state.record);
  const blueprintDocument = useBlueprintStore((state) => state.document);
  const blueprintValidationErrors = useBlueprintStore((state) => state.validationErrors);
  const blueprintIsValid = useBlueprintStore((state) => state.isValid);
  const blueprintPartial = useBlueprintStore((state) => state.partial);
  const blueprintReadError = useBlueprintStore((state) => state.readError);
  const blueprintLoading = useBlueprintStore((state) => state.loading);
  const blueprintError = useBlueprintStore((state) => state.error);
  const loadBlueprint = useBlueprintStore((state) => state.loadForScan);
  const exportBlueprintJson = useBlueprintStore((state) => state.exportJson);
  const clearBlueprint = useBlueprintStore((state) => state.clear);

  // Load (or reload) the project whenever the route id changes. `load` resets
  // the store first, so switching projects never shows the previous one's rows.
  useEffect(() => {
    if (projectId) {
      void load(projectId);
    }
  }, [projectId, load]);

  // Load the per-scan datasets for the active scan. These are read-only: no
  // event mirroring is attached, because a stored project is not live.
  useEffect(() => {
    if (!activeScanId) {
      clearDetections();
      clearViewportCaptures();
      clearClone();
      clearBlueprint();
      return;
    }
    void loadDetections(activeScanId);
    void loadViewportCaptures(activeScanId);
    void loadCloneAssets(activeScanId);
    void loadBlueprint(activeScanId);
  }, [
    activeScanId,
    loadDetections,
    clearDetections,
    loadViewportCaptures,
    clearViewportCaptures,
    loadCloneAssets,
    clearClone,
    loadBlueprint,
    clearBlueprint
  ]);

  async function handleExportBlueprint() {
    const json = await exportBlueprintJson();
    if (!json) {
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `blueprint${activeScanId ? `-${activeScanId}` : ''}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const activeScan = scans.find((scan) => scan.id === activeScanId) ?? null;

  if (status === 'loading' || status === 'idle') {
    return (
      <PageShell title="Project" description="Review a stored reverse-engineering project.">
        <Panel>
          <div className="flex items-center gap-2 py-4 text-caption text-text-muted">
            <StatusIndicator tone="active" label="Loading project" pulse />
            <span>Loading project…</span>
          </div>
        </Panel>
      </PageShell>
    );
  }

  if (status === 'error') {
    return (
      <PageShell title="Project" description="Review a stored reverse-engineering project.">
        <Panel flush>
          <EmptyState
            icon={<IconAlert size={22} />}
            title="Could not load the project"
            description={error?.message ?? 'An unexpected storage error occurred.'}
            action={
              <Button variant="secondary" onClick={() => (projectId ? void load(projectId) : undefined)}>
                Retry
              </Button>
            }
          />
        </Panel>
      </PageShell>
    );
  }

  if (status === 'not_found' || !project) {
    return (
      <PageShell title="Project" description="Review a stored reverse-engineering project.">
        <Panel flush>
          <EmptyState
            icon={<IconProjects size={22} />}
            title="Project not found"
            description="This project no longer exists. It may have been deleted."
            action={
              <Button variant="secondary" onClick={() => navigate('/projects')}>
                Back to Projects
              </Button>
            }
          />
        </Panel>
      </PageShell>
    );
  }

  return (
    <PageShell title={project.name} description={project.targetUrl}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/projects" className="text-caption text-brand hover:underline">
            ← Back to Projects
          </Link>
          <div className="flex items-center gap-2">
            <Badge tone={PROJECT_STATUS_TONE[project.status]}>
              {PROJECT_STATUS_LABEL[project.status]}
            </Badge>
            <span className="text-caption text-text-muted">
              {scans.length} {scans.length === 1 ? 'scan' : 'scans'}
            </span>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Project detail sections"
          className="flex flex-wrap gap-1 border-b border-border-subtle"
        >
          {TABS.map((entry) => {
            const selected = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`project-tab-${entry.id}`}
                aria-selected={selected}
                aria-controls={`project-panel-${entry.id}`}
                onClick={() => setTab(entry.id)}
                className={
                  selected
                    ? '-mb-px border-b-2 border-brand px-3 py-2 text-body text-text-primary'
                    : '-mb-px border-b-2 border-transparent px-3 py-2 text-body text-text-secondary hover:text-text-primary'
                }
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`project-panel-${tab}`}
          aria-labelledby={`project-tab-${tab}`}
          className="flex flex-col gap-4"
        >
          {tab === 'overview' ? (
            <OverviewPanel
              scans={scans}
              activeScan={activeScan}
              onSelectScan={(id) => void selectScan(id)}
            />
          ) : null}

          {tab === 'pages' ? (
            <Panel
              title="Crawled pages"
              actions={
                pages.length > 0 ? <Badge tone="neutral">{pages.length}</Badge> : undefined
              }
            >
              <PagesTable pages={pages} loading={pagesLoading} error={pagesError} />
            </Panel>
          ) : null}

          {tab === 'technologies' ? (
            <Panel
              title="Detected technologies"
              actions={<Badge tone="neutral">{detections.length}</Badge>}
            >
              <TechnologyPanel
                detections={detections}
                loading={detectionsLoading}
                error={detectionsError}
                partial={detectionsPartial}
              />
            </Panel>
          ) : null}

          {tab === 'responsive' ? (
            <Panel
              title="Responsive viewports"
              actions={<Badge tone="neutral">{viewportCaptures.length}</Badge>}
            >
              <ViewportPreview
                captures={viewportCaptures}
                loading={viewportLoading}
                error={viewportError}
              />
            </Panel>
          ) : null}

          {tab === 'assets' ? (
            <Panel
              title="Captured assets"
              actions={<Badge tone="neutral">{cloneAssets.length}</Badge>}
            >
              <AssetList assets={cloneAssets} loading={cloneLoading} error={cloneError} />
            </Panel>
          ) : null}

          {tab === 'blueprint' ? (
            <Panel
              title="Website blueprint"
              actions={
                blueprintRecord ? (
                  blueprintIsValid ? (
                    <Badge tone="success">Valid</Badge>
                  ) : (
                    <Badge tone="danger">Invalid</Badge>
                  )
                ) : undefined
              }
            >
              <BlueprintPanel
                status={blueprintStatus}
                record={blueprintRecord}
                document={blueprintDocument}
                validationErrors={blueprintValidationErrors}
                isValid={blueprintIsValid}
                partial={blueprintPartial}
                readError={blueprintReadError}
                loading={blueprintLoading}
                generating={false}
                error={blueprintError}
                canGenerate={false}
                readOnly
                onGenerate={() => undefined}
                onExport={() => void handleExportBlueprint()}
              />
            </Panel>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}

interface OverviewPanelProps {
  scans: Scan[];
  activeScan: Scan | null;
  onSelectScan: (scanId: string) => void;
}

function OverviewPanel({ scans, activeScan, onSelectScan }: OverviewPanelProps) {
  const project = useProjectDetailStore((state) => state.project);

  return (
    <>
      <Panel title="Project">
        {project ? (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <StatTile label="Target URL" value={project.targetUrl} />
            <StatTile label="Status" value={PROJECT_STATUS_LABEL[project.status]} />
            <StatTile label="Created" value={formatTimestamp(project.createdAt)} />
            <StatTile label="Updated" value={formatTimestamp(project.updatedAt)} />
            <StatTile label="Storage path" value={project.storagePath} />
            <StatTile label="Project id" value={project.id} />
          </dl>
        ) : null}
      </Panel>

      {activeScan ? (
        <Panel
          title="Latest scan"
          actions={
            <Badge tone={SCAN_RECORD_STATUS_TONE[activeScan.status]}>
              {SCAN_RECORD_STATUS_LABEL[activeScan.status]}
            </Badge>
          }
        >
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Pages discovered" value={activeScan.pagesDiscovered} />
              <StatTile label="Pages scanned" value={activeScan.pagesScanned} />
              <StatTile label="Assets downloaded" value={activeScan.assetsDownloaded} />
              <StatTile label="Duration" value={scanDuration(activeScan)} />
              <StatTile label="Depth limit" value={activeScan.depthLimit} />
              <StatTile label="Page limit" value={activeScan.pageLimit} />
              <StatTile label="Started" value={formatTimestamp(activeScan.startedAt)} />
              <StatTile label="Completed" value={formatTimestamp(activeScan.completedAt)} />
            </dl>
            {activeScan.errorDetails ? (
              <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
                <p className="text-caption font-medium text-text-primary">Scan error</p>
                <p className="break-words font-mono text-code text-text-secondary">
                  {activeScan.errorDetails}
                </p>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : (
        <Panel flush>
          <EmptyState
            icon={<IconProjects size={22} />}
            title="No scans recorded"
            description="This project has never been scanned, so there are no results to review."
          />
        </Panel>
      )}

      {scans.length > 0 ? (
        <Panel title="Scan history" flush>
          <ul className="flex flex-col">
            {scans.map((scan) => {
              const selected = scan.id === activeScan?.id;
              return (
                <li
                  key={scan.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-mono text-code text-text-primary">
                      {formatTimestamp(scan.startedAt)}
                    </span>
                    <span className="text-caption text-text-muted">
                      {scan.pagesScanned} scanned · {scan.pagesDiscovered} discovered ·{' '}
                      {scan.assetsDownloaded} assets
                    </span>
                  </div>
                  <Badge tone={SCAN_RECORD_STATUS_TONE[scan.status]}>
                    {SCAN_RECORD_STATUS_LABEL[scan.status]}
                  </Badge>
                  <Button
                    size="sm"
                    variant={selected ? 'secondary' : 'ghost'}
                    disabled={selected}
                    onClick={() => onSelectScan(scan.id)}
                  >
                    {selected ? 'Viewing' : 'View results'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
