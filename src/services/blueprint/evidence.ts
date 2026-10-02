/**
 * Blueprint evidence projection - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.6 and
 * docs/specs/BLUEPRINT-SPEC.md.
 *
 * Loads the bounded, persisted evidence JSON for each completed page (written by
 * the Phase 9 evidence-capture step), validates its shape defensively (the JSON
 * is untrusted), and builds a normalized internal model the pure normalizers
 * consume. Missing or malformed evidence is reported HONESTLY (the page is
 * skipped and counted) - it is never fabricated.
 *
 * SECURITY: evidence contains structure + computed styles only. This module never
 * reads, logs, or emits cookies, storage values, input values, or auth headers.
 */
import type { BlueprintEvidence, BlueprintEvidenceNode } from '../infra/workerProtocol';
import type { ScanPage } from '../../types/models';
import type { z } from 'zod';
import { BlueprintInferenceSchema, BlueprintObservationSchema } from '../../types/blueprint';
import { decodeUtf8, isRecord, parseJson } from './util';

/** Provenance shapes, inferred from the additive schema (decision C8). */
export type BlueprintObservation = z.infer<typeof BlueprintObservationSchema>;
export type BlueprintInference = z.infer<typeof BlueprintInferenceSchema>;

/** Upper bounds so provenance can never balloon the document. */
export const MAX_OBSERVATIONS = 2000;
export const MAX_INFERENCES = 2000;

/** Sandboxed evidence-file read seam (implemented over Rust `blueprint_read`). */
export interface EvidenceIo {
  /** Read the evidence document at a stored relative path, or null when absent. */
  read(path: string): Promise<Uint8Array | null>;
}

/** Outcome of loading one page's evidence. */
export interface LoadedPageEvidence {
  pageId: string;
  url: string;
  path: string;
  evidence: BlueprintEvidence;
  /** True when the capture hit any cap (nodes/bytes/text). */
  truncated: boolean;
  /** Total nodes observed before capping (evidence.nodeCount). */
  nodesObserved: number;
  model: EvidenceModel;
}

/** A page whose evidence was absent or malformed (recorded honestly). */
export interface SkippedPageEvidence {
  pageId: string;
  url: string;
  reason: 'missing' | 'malformed';
}

export interface EvidenceLoadResult {
  loaded: LoadedPageEvidence[];
  skipped: SkippedPageEvidence[];
}

/** The normalized internal evidence model derived from one page's evidence. */
export interface EvidenceModel {
  pageId: string;
  url: string;
  evidence: BlueprintEvidence;
  nodeById: Map<string, BlueprintEvidenceNode>;
  /** Nodes with no parent present in the tree (typically `<html>`). */
  roots: BlueprintEvidenceNode[];
  childrenOf(nodeId: string): BlueprintEvidenceNode[];
  /** Visible nodes only, in evidence order. */
  visibleNodes: BlueprintEvidenceNode[];
  cssVariables: Record<string, string>;
  fontFaces: BlueprintEvidence['fontFaces'];
  forms: BlueprintEvidence['forms'];
  nav: BlueprintEvidence['nav'];
  headings: BlueprintEvidence['headings'];
  links: BlueprintEvidence['links'];
  images: BlueprintEvidence['images'];
  truncated: boolean;
  nodesObserved: number;
}

/** A bounded, deterministic provenance collector (observations + inferences). */
export class ProvenanceCollector {
  private readonly observationList: BlueprintObservation[] = [];
  private readonly inferenceList: BlueprintInference[] = [];
  private readonly observationKeys = new Set<string>();
  private readonly inferenceKeys = new Set<string>();

  addObservation(observation: BlueprintObservation): void {
    if (this.observationList.length >= MAX_OBSERVATIONS) {
      return;
    }
    const key = `${observation.kind}\u0000${observation.ref}\u0000${observation.source}`;
    if (this.observationKeys.has(key)) {
      return;
    }
    this.observationKeys.add(key);
    this.observationList.push(observation);
  }

  addInference(inference: BlueprintInference): void {
    if (this.inferenceList.length >= MAX_INFERENCES) {
      return;
    }
    const key = `${inference.ref}\u0000${inference.method}\u0000${inference.limitation ?? ''}`;
    if (this.inferenceKeys.has(key)) {
      return;
    }
    this.inferenceKeys.add(key);
    this.inferenceList.push(inference);
  }

  observations(): BlueprintObservation[] {
    return [...this.observationList];
  }

  inferences(): BlueprintInference[] {
    return [...this.inferenceList];
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function coerceStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) {
    return out;
  }
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (typeof entry === 'string') {
      out[key] = entry;
    }
  }
  return out;
}

function coerceBounds(value: unknown): BlueprintEvidenceNode['bounds'] {
  const record = isRecord(value) ? value : {};
  const bound = (key: string): number => {
    const raw = record[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  };
  return { x: bound('x'), y: bound('y'), width: bound('width'), height: bound('height') };
}

function coerceStyles(value: unknown): BlueprintEvidenceNode['styles'] {
  const record = isRecord(value) ? value : {};
  const field = (key: string): string => (typeof record[key] === 'string' ? record[key] : '');
  return {
    display: field('display'),
    position: field('position'),
    flexDirection: field('flexDirection'),
    gridTemplateColumns: field('gridTemplateColumns'),
    fontSize: field('fontSize'),
    fontWeight: field('fontWeight'),
    lineHeight: field('lineHeight'),
    color: field('color'),
    backgroundColor: field('backgroundColor'),
    borderColor: field('borderColor'),
    borderRadius: field('borderRadius'),
    boxShadow: field('boxShadow'),
    margin: field('margin'),
    padding: field('padding'),
    gap: field('gap'),
    fontFamily: field('fontFamily')
  };
}

function coerceNode(value: unknown): BlueprintEvidenceNode | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  if (id.length === 0) {
    return null;
  }
  return {
    id,
    parentId: typeof value.parentId === 'string' ? value.parentId : null,
    tag: asString(value.tag),
    role: asString(value.role),
    semantic: asStringArray(value.semantic),
    text: asString(value.text),
    attrs: coerceStringRecord(value.attrs),
    classes: asStringArray(value.classes),
    childIds: asStringArray(value.childIds),
    visible: value.visible === true,
    bounds: coerceBounds(value.bounds),
    styles: coerceStyles(value.styles)
  };
}

/**
 * Defensively validate + normalize a parsed evidence value into a
 * `BlueprintEvidence`. Returns null when the value is not evidence at all
 * (e.g. `{}`, a non-object, or a document without a `nodes` array), so callers
 * can record an honest skip rather than treating garbage as evidence.
 */
export function validateEvidenceShape(value: unknown): BlueprintEvidence | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!Array.isArray(value.nodes)) {
    return null;
  }
  const nodes: BlueprintEvidenceNode[] = [];
  for (const entry of value.nodes) {
    const node = coerceNode(entry);
    if (node) {
      nodes.push(node);
    }
  }

  const fontFaces = Array.isArray(value.fontFaces)
    ? value.fontFaces.filter(isRecord).map((face) => ({
        family: asString(face.family),
        weight: asString(face.weight),
        style: asString(face.style)
      }))
    : [];

  const forms = Array.isArray(value.forms)
    ? value.forms.filter(isRecord).map((form) => ({
        id: asString(form.id),
        name: asString(form.name),
        method: asString(form.method),
        action: asString(form.action),
        submitButtonLabel: asString(form.submitButtonLabel),
        fields: Array.isArray(form.fields)
          ? form.fields.filter(isRecord).map((field) => ({
              name: asString(field.name),
              label: asString(field.label),
              type: asString(field.type),
              required: field.required === true,
              placeholder: typeof field.placeholder === 'string' ? field.placeholder : null,
              options: Array.isArray(field.options)
                ? field.options.filter(isRecord).map((option) => ({
                    label: asString(option.label),
                    value: asString(option.value)
                  }))
                : [],
              validations: coerceStringRecord(field.validations)
            }))
          : []
      }))
    : [];

  const nav = Array.isArray(value.nav)
    ? value.nav.filter(isRecord).map((region) => ({
        region: asString(region.region),
        label: asString(region.label),
        items: Array.isArray(region.items)
          ? region.items.filter(isRecord).map((item) => ({
              href: asString(item.href),
              text: asString(item.text),
              target: typeof item.target === 'string' ? item.target : null,
              depth: typeof item.depth === 'number' && Number.isFinite(item.depth) ? item.depth : 0
            }))
          : []
      }))
    : [];

  const headings = Array.isArray(value.headings)
    ? value.headings.filter(isRecord).map((heading) => ({
        level:
          typeof heading.level === 'number' && Number.isFinite(heading.level) ? heading.level : 1,
        text: asString(heading.text),
        nodeId: asString(heading.nodeId)
      }))
    : [];

  const links = Array.isArray(value.links)
    ? value.links.filter(isRecord).map((link) => ({
        href: asString(link.href),
        text: asString(link.text),
        target: typeof link.target === 'string' ? link.target : null,
        nodeId: asString(link.nodeId)
      }))
    : [];

  const images = Array.isArray(value.images)
    ? value.images.filter(isRecord).map((image) => ({
        src: asString(image.src),
        alt: asString(image.alt),
        width: asNumberOrNull(image.width),
        height: asNumberOrNull(image.height),
        nodeId: asString(image.nodeId)
      }))
    : [];

  const nodeCount =
    typeof value.nodeCount === 'number' && Number.isFinite(value.nodeCount)
      ? Math.max(0, Math.trunc(value.nodeCount))
      : nodes.length;

  const limits = isRecord(value.limits) ? value.limits : {};
  const limit = (key: string): number => {
    const raw = limits[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  };

  return {
    url: asString(value.url),
    status: asNumberOrNull(value.status),
    capturedAt: asString(value.capturedAt),
    nodes,
    cssVariables: coerceStringRecord(value.cssVariables),
    fontFaces,
    forms,
    nav,
    headings,
    links,
    images,
    truncated: value.truncated === true,
    nodeCount,
    byteLength:
      typeof value.byteLength === 'number' && Number.isFinite(value.byteLength)
        ? Math.max(0, Math.trunc(value.byteLength))
        : 0,
    limits: {
      maxNodes: limit('maxNodes'),
      maxBytes: limit('maxBytes'),
      maxTextChars: limit('maxTextChars'),
      maxForms: limit('maxForms'),
      maxCssVars: limit('maxCssVars')
    }
  };
}

/** Build the normalized internal evidence model from validated evidence. */
export function buildEvidenceModel(
  pageId: string,
  url: string,
  evidence: BlueprintEvidence
): EvidenceModel {
  const nodeById = new Map<string, BlueprintEvidenceNode>();
  for (const node of evidence.nodes) {
    if (!nodeById.has(node.id)) {
      nodeById.set(node.id, node);
    }
  }

  const childrenIndex = new Map<string, BlueprintEvidenceNode[]>();
  const roots: BlueprintEvidenceNode[] = [];
  for (const node of evidence.nodes) {
    if (node.parentId !== null && nodeById.has(node.parentId)) {
      const siblings = childrenIndex.get(node.parentId) ?? [];
      siblings.push(node);
      childrenIndex.set(node.parentId, siblings);
    } else {
      roots.push(node);
    }
  }

  const visibleNodes = evidence.nodes.filter((node) => node.visible);

  return {
    pageId,
    url,
    evidence,
    nodeById,
    roots,
    childrenOf: (nodeId: string) => childrenIndex.get(nodeId) ?? [],
    visibleNodes,
    cssVariables: evidence.cssVariables,
    fontFaces: evidence.fontFaces,
    forms: evidence.forms,
    nav: evidence.nav,
    headings: evidence.headings,
    links: evidence.links,
    images: evidence.images,
    truncated: evidence.truncated,
    nodesObserved: evidence.nodeCount
  };
}

/** Parse one page's evidence bytes into a loaded model, or a skip reason. */
export function parsePageEvidence(
  page: ScanPage,
  bytes: Uint8Array | null
): LoadedPageEvidence | SkippedPageEvidence {
  const path = page.blueprintEvidencePath ?? '';
  if (!page.blueprintEvidencePath || bytes === null) {
    return { pageId: page.id, url: page.url, reason: 'missing' };
  }
  const parsed = parseJson(decodeUtf8(bytes));
  const evidence = validateEvidenceShape(parsed);
  if (!evidence) {
    return { pageId: page.id, url: page.url, reason: 'malformed' };
  }
  return {
    pageId: page.id,
    url: page.url,
    path,
    evidence,
    truncated: evidence.truncated,
    nodesObserved: evidence.nodeCount,
    model: buildEvidenceModel(page.id, page.url, evidence)
  };
}

/**
 * Load evidence for a set of completed pages through the sandboxed read seam.
 * A read failure or malformed document becomes an honest skip; this function
 * never throws.
 */
export async function loadPageEvidence(
  pages: ScanPage[],
  io: EvidenceIo
): Promise<EvidenceLoadResult> {
  const loaded: LoadedPageEvidence[] = [];
  const skipped: SkippedPageEvidence[] = [];

  for (const page of pages) {
    if (!page.blueprintEvidencePath) {
      skipped.push({ pageId: page.id, url: page.url, reason: 'missing' });
      continue;
    }
    let bytes: Uint8Array | null = null;
    try {
      bytes = await io.read(page.blueprintEvidencePath);
    } catch {
      bytes = null;
    }
    const result = parsePageEvidence(page, bytes);
    if ('model' in result) {
      loaded.push(result);
    } else {
      skipped.push(result);
    }
  }

  return { loaded, skipped };
}

/** Derive the sandboxed evidence id from a stored `v1/<id>.json` path. */
export function evidenceIdFromPath(path: string): string | null {
  const withoutVersion = path.startsWith('v1/') ? path.slice(3) : path;
  if (!withoutVersion.endsWith('.json')) {
    return null;
  }
  const id = withoutVersion.slice(0, -'.json'.length);
  if (id.length === 0 || id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
    return null;
  }
  return id;
}
