import { useMemo, useState } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { StatusIndicator } from '../ui/StatusIndicator';
import { IconScan } from '../ui/icons';
import type { BlueprintRoot, BlueprintValidationError } from '../../types/blueprint';
import type { Blueprint as BlueprintRecord } from '../../types/models';
import type { BlueprintStatus, BlueprintStoreError } from '../../stores/blueprintStore';
import type { BlueprintDocsDocResult } from '../../services/ipc';
import { planBlueprintDocs } from '../../services/blueprint/docs/catalog';

/**
 * Blueprint viewer - Artupski ReSite
 * Source of truth: docs/specs/BLUEPRINT-SPEC.md, docs/design/UI-SPEC.md section
 * 2.4 (raw interactive JSON viewer + instant schema-validator badge) and
 * docs/impl-plan/phase-9-impl-plan.md section 8.4.
 *
 * Presentational and honest: every value shown comes from the persisted row or
 * the real document (the database is the source of truth). There is no
 * placeholder data, no fabricated count, and no false "valid" badge. The
 * validator badge is driven by the persisted `isValid`; an invalid or
 * unreadable document is surfaced as partial and never presented as ready.
 * This panel is read-only: it does not synthesize Blueprints, generate
 * projects, edit components, or diff visuals.
 */

/** Bound the rendered validation-error list (the store already bounds it). */
export const MAX_RENDERED_VALIDATION_ERRORS = 20;
/** Bound the raw JSON viewer so a large document never freezes the DOM. */
export const MAX_JSON_VIEWER_CHARS = 200_000;

export interface BlueprintPanelProps {
  status: BlueprintStatus;
  /** The persisted row (metadata + validation), or null. */
  record: BlueprintRecord | null;
  /** The parsed document, or null when unreadable/absent. */
  document: BlueprintRoot | null;
  /** Real, bounded validation errors (empty when valid). */
  validationErrors: BlueprintValidationError[];
  /** True only when the persisted document passed the full schema. */
  isValid: boolean;
  /** True when the document is invalid/unreadable (never "ready"). */
  partial: boolean;
  /** Honest reason the document body could not be read, or null. */
  readError: string | null;
  loading: boolean;
  generating: boolean;
  error: BlueprintStoreError | null;
  /** True when the target scan is completed and a Blueprint can be produced. */
  canGenerate: boolean;
  onGenerate: () => void;
  /** Export the loaded document as pretty JSON. */
  onExport: () => void;
  /** Generated documentation from the last docs run (empty until one runs). */
  docs?: BlueprintDocsDocResult[];
  /** Optional documents intentionally skipped in the last docs run. */
  docsSkipped?: Array<{ name: string; title: string; required: boolean }>;
  /** Bounded warnings from the last docs run. */
  docsWarnings?: Array<{ doc: string; code: string; message: string }>;
  /** True while a documentation run is in flight. */
  generatingDocs?: boolean;
  /** Generate the documentation set for the loaded Blueprint. */
  onGenerateDocs?: () => void;
}

/** Human, locale-aware timestamp; an unparseable value is shown verbatim. */
function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

/** One real metadata row; omitted entirely when the value is not known. */
function MetaRow({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === '') {
    return null;
  }
  return (
    <div className="rounded border border-border-subtle bg-base px-3 py-2">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="truncate font-mono text-code text-text-primary" title={String(value)}>
        {value}
      </dd>
    </div>
  );
}

export function BlueprintPanel({
  status,
  record,
  document,
  validationErrors,
  isValid,
  partial,
  readError,
  loading,
  generating,
  error,
  canGenerate,
  onGenerate,
  onExport,
  docs = [],
  docsSkipped = [],
  docsWarnings = [],
  generatingDocs = false,
  onGenerateDocs
}: BlueprintPanelProps) {
  const [copied, setCopied] = useState(false);

  // The planned documentation set is derived deterministically from the loaded
  // document (required docs + relevant/opted-in optionals). Nothing is invented:
  // when no document is loaded, no plan is shown.
  const docPlan = useMemo(() => {
    if (!document) {
      return [];
    }
    try {
      return planBlueprintDocs(document);
    } catch {
      return [];
    }
  }, [document]);
  const generatedByName = useMemo(
    () => new Map(docs.map((doc) => [doc.name, doc])),
    [docs]
  );

  const json = useMemo(() => {
    if (!document) {
      return null;
    }
    return JSON.stringify(document, null, 2);
  }, [document]);

  const jsonTruncated = json !== null && json.length > MAX_JSON_VIEWER_CHARS;
  const jsonShown = json !== null ? json.slice(0, MAX_JSON_VIEWER_CHARS) : null;

  const errors = validationErrors.slice(0, MAX_RENDERED_VALIDATION_ERRORS);
  const hiddenErrors = validationErrors.length - errors.length;

  const showInitialLoading = (loading || status === 'idle') && record === null;
  const canExport = record !== null && !loading;

  async function handleCopy(): Promise<void> {
    if (!json || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-caption text-text-muted">
          A schema-validated, framework-agnostic description of the crawled site. Generated
          deterministically from captured evidence; nothing is inferred beyond that evidence.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={!canGenerate || generating}
            onClick={() => void onGenerate()}
          >
            {generating ? 'Generating…' : record ? 'Regenerate blueprint' : 'Generate blueprint'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canExport}
            onClick={() => void onExport()}
          >
            Export Blueprint JSON
          </Button>
          {onGenerateDocs ? (
            <Button
              type="button"
              variant="secondary"
              disabled={!canExport || generatingDocs}
              onClick={() => void onGenerateDocs()}
            >
              {generatingDocs ? 'Generating docs…' : 'Generate docs'}
            </Button>
          ) : null}
        </div>
      </div>

      {!canGenerate ? (
        <p className="text-caption text-text-muted">
          A Blueprint can be generated once the scan has completed.
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
          <p className="text-body text-text-primary">{error.message}</p>
          {error.suggestedAction ? (
            <p className="text-caption text-text-muted">{error.suggestedAction}</p>
          ) : null}
        </div>
      ) : null}

      {generating ? (
        <div className="flex items-center gap-2 py-1 text-caption text-text-muted">
          <StatusIndicator tone="active" label="Generating blueprint" pulse />
          <span>Normalizing captured evidence…</span>
        </div>
      ) : null}

      {showInitialLoading ? (
        <div className="flex items-center gap-2 py-2 text-caption text-text-muted">
          <StatusIndicator tone="active" label="Loading blueprint" pulse />
          <span>Loading Blueprint…</span>
        </div>
      ) : null}

      {!showInitialLoading && record === null && !error && !generating ? (
        <EmptyState
          icon={<IconScan size={18} />}
          title="No blueprint yet"
          description="Run a scan to completion, then generate a Blueprint to inspect its schema-validated structure and export the JSON."
        />
      ) : null}

      {record !== null ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-text-muted">Schema validator</span>
            {isValid ? <Badge tone="success">Valid</Badge> : <Badge tone="danger">Invalid</Badge>}
            {partial ? <Badge tone="warning">Partial</Badge> : null}
          </div>

          {partial ? (
            <p role="status" className="text-caption text-warning">
              This Blueprint is {isValid ? 'unreadable' : 'schema-invalid'}. It is shown exactly as
              persisted and is never presented as ready.
            </p>
          ) : null}

          {readError ? (
            <p role="status" className="text-caption text-warning">
              {readError}
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetaRow label="Blueprint version" value={record.version} />
            <MetaRow label="Schema version" value={record.schemaVersion} />
            <MetaRow
              label="Generated at"
              value={document ? formatTimestamp(document.generated_at) : null}
            />
            <MetaRow label="Pages" value={document ? document.pages.length : null} />
            <MetaRow label="Components" value={document ? document.components.length : null} />
            <MetaRow label="Routes" value={document ? document.routes.length : null} />
            <MetaRow
              label="Generator"
              value={document ? `${document.generator.name} ${document.generator.version}` : null}
            />
            <MetaRow label="Updated" value={formatTimestamp(record.updatedAt)} />
          </dl>

          {validationErrors.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-caption font-medium text-text-secondary">
                Validation errors ({validationErrors.length})
              </span>
              <ul
                aria-label="Blueprint validation errors"
                className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-subtle bg-base p-2"
              >
                {errors.map((issue, index) => (
                  <li key={`${issue.path}-${index}`} className="flex flex-col gap-0.5">
                    <span className="font-mono text-code text-text-primary">{issue.path}</span>
                    <span className="text-caption text-text-secondary">{issue.message}</span>
                  </li>
                ))}
              </ul>
              {hiddenErrors > 0 ? (
                <span className="text-caption text-text-muted">
                  {hiddenErrors} more error(s) not shown.
                </span>
              ) : null}
            </div>
          ) : isValid ? (
            <p className="text-caption text-text-muted">
              No validation errors — the document passes the Blueprint schema.
            </p>
          ) : null}

          {docPlan.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption font-medium text-text-secondary">
                  Documentation ({docPlan.length} doc{docPlan.length === 1 ? '' : 's'})
                </span>
                <span className="text-caption text-text-muted">
                  {docs.length > 0
                    ? `${docs.length} generated`
                    : 'Not generated yet — required docs are always produced'}
                </span>
              </div>

              {generatingDocs ? (
                <div className="flex items-center gap-2 py-1 text-caption text-text-muted">
                  <StatusIndicator tone="active" label="Generating documentation" pulse />
                  <span>Generating documentation set…</span>
                </div>
              ) : null}

              <ul
                aria-label="Planned documentation"
                className="flex flex-col gap-1 rounded border border-border-subtle bg-base p-2"
              >
                {docPlan.map((entry) => {
                  const generated = generatedByName.get(entry.name);
                  return (
                    <li
                      key={entry.name}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="font-mono text-code text-text-primary">{entry.name}</span>
                      <span className="flex items-center gap-2">
                        {entry.required ? (
                          <Badge tone="neutral">Required</Badge>
                        ) : (
                          <Badge tone="brand">
                            {entry.reason === 'opted_in' ? 'Opted in' : 'Relevant'}
                          </Badge>
                        )}
                        {generated ? (
                          <>
                            <Badge tone={generated.source === 'ai' ? 'success' : 'neutral'}>
                              {generated.source === 'ai' ? 'AI' : 'Deterministic'}
                            </Badge>
                            <span className="text-caption text-text-muted">
                              {generated.bytes.toLocaleString()} bytes
                            </span>
                          </>
                        ) : (
                          <Badge tone="warning">Pending</Badge>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {docsSkipped.length > 0 ? (
                <span className="text-caption text-text-muted">
                  Optional docs not generated (no relevance signal):{' '}
                  {docsSkipped.map((entry) => entry.name).join(', ')}
                </span>
              ) : null}

              {docsWarnings.length > 0 ? (
                <ul
                  aria-label="Documentation warnings"
                  className="flex flex-col gap-1 rounded border border-warning/40 bg-warning/10 p-2"
                >
                  {docsWarnings.map((warning, index) => (
                    <li key={`${warning.doc}-${warning.code}-${index}`} className="text-caption text-text-secondary">
                      <span className="font-mono text-code text-text-primary">{warning.doc}</span>{' '}
                      {warning.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-caption font-medium text-text-secondary">Raw JSON</span>
              <div className="flex items-center gap-2">
                <span className="text-caption text-text-muted">
                  {json ? `${json.length.toLocaleString()} chars` : 'unavailable'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!json}
                  onClick={() => void handleCopy()}
                >
                  Copy JSON
                </Button>
                <span aria-live="polite" className="text-caption text-success">
                  {copied ? 'Copied' : ''}
                </span>
              </div>
            </div>
            {jsonShown !== null ? (
              <>
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label="Blueprint JSON document"
                  className="max-h-80 overflow-auto rounded border border-border-subtle bg-base p-2 font-mono text-code text-text-secondary"
                >
                  {jsonShown}
                </pre>
                {jsonTruncated ? (
                  <span className="text-caption text-warning">
                    Viewer truncated at {MAX_JSON_VIEWER_CHARS.toLocaleString()} characters. Use
                    Export Blueprint JSON for the complete document.
                  </span>
                ) : null}
              </>
            ) : (
              <p className="text-caption text-text-muted">
                The document body could not be read; raw JSON is unavailable.
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
