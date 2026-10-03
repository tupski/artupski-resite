import { useEffect, useMemo, useRef, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { StatusIndicator, type StatusTone } from '../components/ui/StatusIndicator';
import { IconAlert } from '../components/ui/icons';
import { TechnologyPanel } from '../components/scan/TechnologyPanel';
import { ViewportPreview } from '../components/scan/ViewportPreview';
import { ClonePanel } from '../components/clone/ClonePanel';
import { BlueprintPanel } from '../components/blueprint/BlueprintPanel';
import { DiffViewer } from '../components/diff/DiffViewer';
import { AuthCapturePanel } from '../components/auth/AuthCapturePanel';
import { SCAN_STATUS_LABEL, type ScanStatus } from '../types/scan';
import { scanConfigurationFromCrawler, useScanStore } from '../stores/scanStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useProjectsStore } from '../stores/projectsStore';
import { useTechnologyStore } from '../stores/technologyStore';
import { useAuthStore } from '../stores/authStore';
import { useResponsiveStore } from '../stores/responsiveStore';
import { useCloneStore } from '../stores/cloneStore';
import { useBlueprintStore } from '../stores/blueprintStore';
import { useDiffStore } from '../stores/diffStore';
import { runClone, isCloneAvailable } from '../services/clone/runClone';
import { runVisualDiff } from '../services/diff';
import { validateTargetUrl } from '../lib/url';
import { cn } from '../lib/cn';

/**
 * Scan configuration + execution surface (UI-SPEC sections 2.1 and 2.2, subset).
 *
 * Phase 4 (workstream 3) wires this to the real crawler: Start delegates to the
 * scan store/service and progress is driven by the crawl's own events. No
 * percentage or counter is fabricated. Controls the crawler does not honor yet
 * (viewports / responsive capture) are shown disabled and labelled deferred
 * rather than pretending to work.
 */

const STATUS_TONE: Record<ScanStatus, StatusTone> = {
  idle: 'idle',
  configuring: 'idle',
  scanning: 'active',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning'
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function ScanRoute() {
  const targetUrl = useScanStore((state) => state.targetUrl);
  const setTargetUrl = useScanStore((state) => state.setTargetUrl);
  const projectId = useScanStore((state) => state.projectId);
  const setProjectId = useScanStore((state) => state.setProjectId);
  const setProjectTitle = useScanStore((state) => state.setProjectTitle);
  const configuration = useScanStore((state) => state.configuration);
  const updateConfiguration = useScanStore((state) => state.updateConfiguration);
  const setConfiguration = useScanStore((state) => state.setConfiguration);
  const status = useScanStore((state) => state.status);
  const progress = useScanStore((state) => state.progress);
  const logs = useScanStore((state) => state.logs);
  const discoveredPages = useScanStore((state) => state.discoveredPages);
  const error = useScanStore((state) => state.error);
  const startScan = useScanStore((state) => state.startScan);
  const cancelScan = useScanStore((state) => state.cancelScan);

  const projects = useProjectsStore((state) => state.projects);
  const loadProjects = useProjectsStore((state) => state.loadProjects);
  const createProject = useProjectsStore((state) => state.createProject);
  const mutating = useProjectsStore((state) => state.mutating);

  const scanId = useScanStore((state) => state.scanId);
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
  const cloneReport = useCloneStore((state) => state.lastReport);
  const clonePreviewUrl = useCloneStore((state) => state.previewUrl);
  const clonePreviewBusy = useCloneStore((state) => state.previewBusy);
  const loadCloneAssets = useCloneStore((state) => state.loadForScan);
  const setCloneReport = useCloneStore((state) => state.setReport);
  const setCloneError = useCloneStore((state) => state.setError);
  const openClonePreview = useCloneStore((state) => state.openPreview);
  const closeClonePreview = useCloneStore((state) => state.closePreview);
  const clearClone = useCloneStore((state) => state.clear);
  const [cloneGenerating, setCloneGenerating] = useState(false);

  const diffStatus = useDiffStore((state) => state.status);
  const diffReport = useDiffStore((state) => state.report);
  const diffError = useDiffStore((state) => state.error);
  const diffActiveProfile = useDiffStore((state) => state.activeProfile);
  const beginDiff = useDiffStore((state) => state.begin);
  const setDiffReport = useDiffStore((state) => state.setReport);
  const setDiffError = useDiffStore((state) => state.setError);
  const setDiffActiveProfile = useDiffStore((state) => state.setActiveProfile);
  const [diffGenerating, setDiffGenerating] = useState(false);
  // Phase 12 exposes no persisted project path, so the caller supplies the
  // generated project root explicitly; it is never guessed.
  const [diffProjectRoot, setDiffProjectRoot] = useState('');
  const cloneAvailable = isCloneAvailable();

  const blueprintStatus = useBlueprintStore((state) => state.status);
  const blueprintRecord = useBlueprintStore((state) => state.record);
  const blueprintDocument = useBlueprintStore((state) => state.document);
  const blueprintValidationErrors = useBlueprintStore((state) => state.validationErrors);
  const blueprintIsValid = useBlueprintStore((state) => state.isValid);
  const blueprintPartial = useBlueprintStore((state) => state.partial);
  const blueprintReadError = useBlueprintStore((state) => state.readError);
  const blueprintLoading = useBlueprintStore((state) => state.loading);
  const blueprintGenerating = useBlueprintStore((state) => state.generating);
  const blueprintError = useBlueprintStore((state) => state.error);
  const loadBlueprint = useBlueprintStore((state) => state.loadForScan);
  const generateBlueprint = useBlueprintStore((state) => state.generate);
  const exportBlueprintJson = useBlueprintStore((state) => state.exportJson);
  const clearBlueprint = useBlueprintStore((state) => state.clear);

  const authMode = useAuthStore((state) => state.mode);
  const authSession = useAuthStore((state) => state.session);
  const authBusy = useAuthStore((state) => state.busy);
  const authError = useAuthStore((state) => state.error);
  const authCaptureStatus = useAuthStore((state) => state.captureStatus);
  const setAuthMode = useAuthStore((state) => state.setMode);
  const refreshAuth = useAuthStore((state) => state.refresh);
  const clearAuth = useAuthStore((state) => state.clear);

  const cancelRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const previousStatus = useRef<ScanStatus>(status);

  const validation = validateTargetUrl(targetUrl);
  const scanning = status === 'scanning';

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Seed the (per-scan editable) configuration from persisted crawler defaults
  // once on mount. Re-seeding while a crawl is in flight would discard the
  // configuration that crawl is already using, so it is skipped then. The user
  // can still change any value on this screen for the current run.
  const seededFromSettings = useRef(false);
  useEffect(() => {
    if (seededFromSettings.current || status === 'scanning') {
      return;
    }
    seededFromSettings.current = true;
    const crawler = useSettingsStore.getState().crawler;
    setConfiguration(scanConfigurationFromCrawler(crawler));
  }, [status, setConfiguration]);

  // Keep the selected project in sync with the typed URL so scanning never
  // silently targets the wrong project. A matching project is auto-selected;
  // an unmatched URL clears the selection (the user must create the project).
  const validUrl = validation.valid ? validation.url : null;
  const matchedProject = useMemo(
    () => (validUrl ? projects.find((project) => project.targetUrl === validUrl) : undefined),
    [projects, validUrl]
  );

  useEffect(() => {
    if (matchedProject) {
      if (projectId !== matchedProject.id) {
        setProjectId(matchedProject.id);
        setProjectTitle(matchedProject.name);
      }
    } else if (projectId !== null) {
      setProjectId(null);
      setProjectTitle('');
    }
  }, [matchedProject, projectId, setProjectId, setProjectTitle]);

  // Move focus deliberately as the lifecycle changes so keyboard users are not
  // stranded: to Cancel when a scan starts, to the result region when it ends.
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (status === previous) {
      return;
    }
    if (status === 'scanning') {
      cancelRef.current?.focus();
    } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      statusRef.current?.focus();
    }
  }, [status]);

  // Load persisted detections when a scan id appears, and mirror live detection
  // events while the scan finishes. The database is the source of truth; the
  // event subscription only triggers a refresh.
  useEffect(() => {
    if (!scanId) {
      clearDetections();
      return;
    }
    void loadDetections(scanId);
    const unsubscribe = useTechnologyStore.getState().watch(scanId);
    return unsubscribe;
  }, [scanId, loadDetections, clearDetections]);

  // Load persisted viewport captures when a scan id appears; the database is the
  // source of truth. The responsive step runs after the crawl completes, so this
  // also re-checks when the scan settles.
  useEffect(() => {
    if (!scanId) {
      clearViewportCaptures();
      return;
    }
    void loadViewportCaptures(scanId);
  }, [scanId, status, loadViewportCaptures, clearViewportCaptures]);

  // Load persisted clone assets when a scan id appears (DB is source of truth).
  useEffect(() => {
    if (!scanId) {
      clearClone();
      return;
    }
    void loadCloneAssets(scanId);
  }, [scanId, loadCloneAssets, clearClone]);

  // Load the latest persisted Blueprint when a scan id appears, and mirror live
  // `blueprint.*` events while it settles. The database is the source of truth.
  useEffect(() => {
    if (!scanId) {
      clearBlueprint();
      return;
    }
    void loadBlueprint(scanId);
    const unsubscribe = useBlueprintStore.getState().watch(scanId);
    return unsubscribe;
  }, [scanId, loadBlueprint, clearBlueprint]);

  async function handleGenerateClone() {
    if (!scanId || !validation.valid) {
      return;
    }
    setCloneGenerating(true);
    try {
      const result = await runClone({
        scanId,
        projectId: projectId ?? '',
        seedUrl: validation.url
      });
      if (!result.ok) {
        // Surface the structured error through the store's error channel.
        setCloneError(result.error);
        setCloneReport(null);
      } else {
        setCloneError(null);
        setCloneReport(result.data.report);
        await loadCloneAssets(scanId);
      }
    } finally {
      setCloneGenerating(false);
    }
  }

  // Generate (or regenerate) a Blueprint for the completed scan. The store
  // owns the lifecycle + reload; failures are surfaced through its error channel.
  async function handleGenerateBlueprint() {
    if (!scanId) {
      return;
    }
    await generateBlueprint({
      scanId,
      projectId: projectId ?? '',
      ...(validation.valid ? { sourceUrl: validation.url } : {})
    });
  }

  // Export the loaded Blueprint as a JSON file download. The document is read
  // through the store (sandboxed seam); an unreadable document yields nothing.
  async function handleExportBlueprint() {
    const json = await exportBlueprintJson();
    if (!json) {
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `blueprint${scanId ? `-${scanId}` : ''}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  // Run the Phase 13 visual comparison: screenshot the generated project's
  // built output and diff it against the original captured page(s). The
  // generated project root is caller-supplied (Phase 12 has no UI/persistence),
  // so nothing is guessed. The diff store owns the honest lifecycle; a setup
  // failure is surfaced through its error channel.
  async function handleRunDiff() {
    if (!scanId) {
      return;
    }
    beginDiff();
    setDiffGenerating(true);
    try {
      const routeTargets = (blueprintDocument?.routes ?? []).map((route) => ({ path: route.path }));
      const profiles = Array.from(new Set(viewportCaptures.map((capture) => capture.profile)));
      const originals = Object.fromEntries(
        viewportCaptures.map((capture) => [
          capture.profile,
          {
            profile: capture.profile,
            screenshotPath: capture.screenshotPath,
            width: capture.width,
            height: capture.height
          }
        ])
      );
      const report = await runVisualDiff(diffProjectRoot.trim(), {
        routes: routeTargets.length > 0 ? routeTargets : [{ path: '/' }],
        profiles: profiles.length > 0 ? profiles : ['desktop'],
        originals
      });
      setDiffReport(report);
      if (!report.ok && report.error) {
        setDiffError(report.error);
      }
    } finally {
      setDiffGenerating(false);
    }
  }

  // Keep the auth panel in sync with the selected project's persisted session
  // (the database is the source of truth; never a hardcoded "ready").
  useEffect(() => {
    void refreshAuth(projectId);
  }, [projectId, refreshAuth]);

  // A session can only be selected when one actually exists for the project.
  useEffect(() => {
    if (authMode === 'session' && authSession === null && !authBusy) {
      setAuthMode('none');
    }
  }, [authMode, authSession, authBusy, setAuthMode]);

  const canStart = validation.valid && projectId !== null && !scanning && !mutating;
  const needsProject = validation.valid && projectId === null;

  async function handleCreateProject() {
    if (!validation.valid) {
      return;
    }
    const name = validation.host;
    const created = await createProject({ name, targetUrl: validation.url });
    if (created) {
      const project = useProjectsStore
        .getState()
        .projects.find((candidate) => candidate.targetUrl === validation.url);
      if (project) {
        setProjectId(project.id);
        setProjectTitle(project.name);
      }
    }
  }

  const progressLabel = scanning
    ? `${progress.pagesScanned} scanned · ${progress.pagesDiscovered} discovered`
    : status === 'completed'
      ? `${progress.pagesScanned} pages scanned`
      : 'No crawl in progress';

  return (
    <PageShell title="Scan" description="Crawl a target website and extract page data.">
      <div className="flex flex-col gap-4">
        <Panel
          title="Target"
          actions={
            <StatusIndicator
              tone={STATUS_TONE[status]}
              label={SCAN_STATUS_LABEL[status]}
              pulse={scanning}
            />
          }
        >
          <div className="flex flex-col gap-3">
            <Input
              label="Target website URL"
              placeholder="https://example.com"
              value={targetUrl}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              inputClassName="font-mono text-code"
              onChange={(event) => setTargetUrl(event.target.value)}
              disabled={scanning}
              error={targetUrl.trim().length > 0 && !validation.valid ? validation.message : null}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-caption text-text-secondary">
                <span className="text-text-muted">Project</span>
                {matchedProject ? (
                  <span className="truncate text-text-primary">{matchedProject.name}</span>
                ) : (
                  <span className="text-text-muted">
                    {validation.valid ? 'No project for this URL yet' : 'Enter a valid URL first'}
                  </span>
                )}
              </div>
              {needsProject ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={mutating}
                  onClick={() => void handleCreateProject()}
                >
                  {mutating ? 'Creating…' : 'Create project for this URL'}
                </Button>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel
          title="Authentication"
          actions={
            authSession ? (
              <Badge tone="success">Session ready</Badge>
            ) : authCaptureStatus === 'awaiting_login' ||
              authCaptureStatus === 'capturing' ||
              authCaptureStatus === 'launching' ? (
              <Badge tone="warning">Capturing</Badge>
            ) : (
              <Badge tone="neutral">No session</Badge>
            )
          }
        >
          <div className="flex flex-col gap-3">
            <fieldset disabled={scanning} className="flex flex-col gap-2">
              <legend className="sr-only">Authentication mode</legend>
              <label className="flex items-start gap-2 text-body text-text-secondary">
                <input
                  type="radio"
                  name="auth-mode"
                  className="mt-0.5 h-3.5 w-3.5 accent-brand"
                  checked={authMode === 'none'}
                  onChange={() => setAuthMode('none')}
                />
                <span>
                  <span className="text-text-primary">No authentication</span>
                  <span className="block text-caption text-text-muted">
                    Crawl only publicly accessible pages.
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  'flex items-start gap-2 text-body',
                  authSession ? 'text-text-secondary' : 'text-text-muted opacity-60'
                )}
              >
                <input
                  type="radio"
                  name="auth-mode"
                  className="mt-0.5 h-3.5 w-3.5 accent-brand"
                  checked={authMode === 'session'}
                  disabled={!authSession}
                  onChange={() => setAuthMode('session')}
                />
                <span>
                  <span className="text-text-primary">Use saved session</span>
                  <span className="block text-caption text-text-muted">
                    {authSession
                      ? `Captured for ${authSession.targetDomain} · ${authSession.cookieCount} cookie(s)`
                      : 'No session captured for this project yet.'}
                  </span>
                </span>
              </label>
            </fieldset>

            <AuthCapturePanel
              projectId={projectId}
              targetUrl={validation.valid ? validation.url : targetUrl}
              disabled={scanning}
            />

            {authSession ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle px-3 py-2">
                <span className="text-caption text-text-muted">
                  Captured {formatTime(authSession.createdAt)}
                  {authSession.expiresAt ? ` · expires ${formatTime(authSession.expiresAt)}` : ''}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={scanning || authBusy}
                  onClick={() => void clearAuth(projectId)}
                >
                  {authBusy ? 'Clearing...' : 'Clear saved session'}
                </Button>
              </div>
            ) : null}

            {authError ? (
              <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
                <p className="text-body text-text-primary">{authError.message}</p>
                <p className="text-caption text-text-muted">{authError.suggestedAction}</p>
              </div>
            ) : null}

            <p className="text-caption text-text-muted">
              Sessions are stored encrypted on this device only and are never sent to any service.
              You sign in yourself in a real browser window; ReSite captures only the resulting
              session state, never your password or MFA codes.
            </p>
          </div>
        </Panel>

        <Panel title="Crawl configuration">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Max crawl depth"
              type="number"
              min={1}
              max={5}
              value={configuration.maxDepth}
              disabled={scanning}
              onChange={(event) =>
                updateConfiguration({ maxDepth: clamp(Number(event.target.value), 1, 5) })
              }
              hint="1 to 5 link levels from the seed"
            />
            <Input
              label="Max pages"
              type="number"
              min={1}
              max={200}
              value={configuration.maxPages}
              disabled={scanning}
              onChange={(event) =>
                updateConfiguration({ maxPages: clamp(Number(event.target.value), 1, 200) })
              }
              hint="Hard upper bound on crawled pages"
            />
          </div>

          <label className="mt-4 flex items-center gap-2 text-body text-text-secondary">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand"
              checked={configuration.headless}
              disabled={scanning}
              onChange={(event) => updateConfiguration({ headless: event.target.checked })}
            />
            Run headless
          </label>

          <label className="mt-2 flex items-center gap-2 text-body text-text-secondary">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand"
              checked={configuration.blueprint}
              disabled={scanning}
              onChange={(event) => updateConfiguration({ blueprint: event.target.checked })}
            />
            Generate blueprint after crawl
          </label>

          <fieldset
            className="mt-4 rounded border border-border-subtle p-3"
            disabled={scanning}
            aria-describedby="viewports-note"
          >
            <legend className="px-1 text-caption font-medium text-text-secondary">Viewports</legend>
            <div className="flex flex-wrap gap-3 pt-1">
              {(
                [
                  ['desktop', 'Desktop 1440×900'],
                  ['tablet', 'Tablet 768×1024'],
                  ['mobile', 'Mobile 375×812']
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-body text-text-secondary">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-brand"
                    checked={configuration.viewports[key]}
                    onChange={(event) =>
                      updateConfiguration({
                        viewports: { ...configuration.viewports, [key]: event.target.checked }
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <p id="viewports-note" className="pt-2 text-caption text-text-muted">
              Each selected viewport is captured after the crawl when it completes, producing a
              full-page screenshot and a visible-element map for that breakpoint.
            </p>
          </fieldset>
        </Panel>

        <Panel title="Execute">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-caption text-text-muted">
                Crawls the target and stores page metadata for the owning project. One crawl runs at
                a time.
              </p>
              <div className="flex items-center gap-2">
                {scanning ? (
                  <Button ref={cancelRef} variant="danger" onClick={() => void cancelScan()}>
                    Cancel scan
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="primary"
                  disabled={!canStart}
                  onClick={() => void startScan()}
                >
                  {scanning ? 'Scanning…' : 'Start scan'}
                </Button>
              </div>
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2"
              >
                <span className="mt-0.5 text-danger" aria-hidden="true">
                  <IconAlert size={15} />
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-body text-text-primary">{error.message}</p>
                  <p className="text-caption text-text-secondary">{error.suggestedAction}</p>
                </div>
              </div>
            ) : null}

            <div
              ref={statusRef}
              tabIndex={-1}
              aria-live="polite"
              className="flex flex-col gap-2 outline-none"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-text-secondary">{progressLabel}</span>
                {scanning ? (
                  <span className="font-mono text-code text-text-muted">
                    {progress.currentUrl ?? 'starting…'}
                  </span>
                ) : null}
              </div>
              <div
                role="progressbar"
                aria-label="Crawl progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percentage}
                className="h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated"
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-200 ${
                    status === 'failed'
                      ? 'bg-danger'
                      : status === 'cancelled'
                        ? 'bg-warning'
                        : 'bg-brand'
                  }`}
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>

            {logs.length > 0 || discoveredPages.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-caption font-medium text-text-secondary">
                    Activity ({logs.length})
                  </span>
                  <ul
                    aria-label="Scan activity log"
                    aria-live="polite"
                    className="h-40 overflow-y-auto rounded border border-border-subtle bg-base p-2 font-mono text-code"
                  >
                    {logs.length === 0 ? (
                      <li className="text-text-muted">No activity yet.</li>
                    ) : (
                      logs.map((entry) => (
                        <li
                          key={entry.id}
                          className={
                            entry.level === 'error'
                              ? 'text-danger'
                              : entry.level === 'warn'
                                ? 'text-warning'
                                : 'text-text-secondary'
                          }
                        >
                          <span className="text-text-muted">{formatTime(entry.timestamp)} </span>
                          {entry.message}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-caption font-medium text-text-secondary">
                    Discovered pages ({discoveredPages.length})
                  </span>
                  <ul className="h-40 overflow-y-auto rounded border border-border-subtle bg-base p-2 font-mono text-code">
                    {discoveredPages.length === 0 ? (
                      <li className="text-text-muted">None yet.</li>
                    ) : (
                      discoveredPages.map((url) => (
                        <li key={url} className="truncate text-text-secondary" title={url}>
                          {url}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </Panel>

        {scanId ? (
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

        {scanId ? (
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

        {scanId ? (
          <Panel
            title="Static clone"
            actions={
              cloneAssets.length > 0 ? (
                <Badge tone="neutral">{cloneAssets.length}</Badge>
              ) : undefined
            }
          >
            <ClonePanel
              assets={cloneAssets}
              loading={cloneLoading}
              error={cloneError}
              report={cloneReport}
              previewUrl={clonePreviewUrl}
              previewBusy={clonePreviewBusy}
              canGenerate={status === 'completed'}
              generating={cloneGenerating}
              notReady={!cloneAvailable}
              onGenerate={() => void handleGenerateClone()}
              onOpenPreview={() => void openClonePreview()}
              onClosePreview={() => void closeClonePreview()}
            />
          </Panel>
        ) : null}

        {scanId ? (
          <Panel
            title="Visual comparison"
            actions={
              diffReport ? (
                <Badge
                  tone={
                    !diffReport.ok
                      ? 'danger'
                      : diffReport.summary.partial
                        ? 'warning'
                        : 'success'
                  }
                >
                  {diffReport.ok
                    ? `${diffReport.summary.averageSimilarityPercent.toFixed(2)}%`
                    : 'Failed'}
                </Badge>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-3">
              <Input
                label="Generated project root"
                value={diffProjectRoot}
                placeholder="Absolute path to the generated Vite project (contains dist/)"
                hint="The built output under dist/ is served on loopback and screenshotted."
                spellCheck={false}
                onChange={(event) => setDiffProjectRoot(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={diffGenerating || !cloneAvailable || diffProjectRoot.trim().length === 0}
                  onClick={() => void handleRunDiff()}
                >
                  {diffGenerating ? 'Comparing…' : 'Run comparison'}
                </Button>
                <span className="text-caption text-text-muted">
                  {!cloneAvailable
                    ? 'Available in the desktop shell only.'
                    : 'Screenshots the generated project and compares it with the original capture.'}
                </span>
              </div>
              <DiffViewer
                report={diffReport}
                loading={diffStatus === 'running'}
                error={diffError ? diffError.message : null}
                activeProfile={diffActiveProfile}
                onSelectProfile={setDiffActiveProfile}
              />
            </div>
          </Panel>
        ) : null}

        {scanId ? (
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
              generating={blueprintGenerating}
              error={blueprintError}
              canGenerate={status === 'completed'}
              onGenerate={() => void handleGenerateBlueprint()}
              onExport={() => void handleExportBlueprint()}
            />
          </Panel>
        ) : null}
      </div>
    </PageShell>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return date.toLocaleTimeString();
}
