/**
 * Project documentation generator - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 14) and
 * docs/impl-plan/phase-14-impl-plan.md sections 7.1, 7.9.
 *
 * Emits exactly three deterministic Markdown documents (`README.md`,
 * `ARCHITECTURE.md`, `COMPONENTS.md`) from a `DocGenerationInput`. It is PURE and
 * side-effect-free: it derives every fact from the Phase 12 report and the
 * caller-supplied metadata, and it NEVER fabricates routes, components, assets,
 * or copy that the report does not contain. Absent sections are omitted.
 *
 * All text is neutralized so it cannot break the Markdown structure: pipes are
 * escaped inside table cells, leading `#` is escaped in headings, backticks are
 * handled with a dynamically sized code span, and newlines are collapsed. A
 * document exceeding `MAX_EXPORT_DOC_BYTES` is refused rather than emitted.
 */
import {
  MAX_EXPORT_DOC_BYTES,
  type DocGenerationInput,
  type DocGenerationResult,
  type ExportFailure,
  type GeneratedDoc,
  type GeneratedDocName
} from '../../types/export';

/* -------------------------------------------------------------------------- */
/* Text safety helpers                                                        */
/* -------------------------------------------------------------------------- */

/** UTF-8 byte length of a string. */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Longest run of consecutive backticks in `value` (for a safe code span). */
function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    if (char === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/** A code span whose delimiter is longer than any backtick run in `value`. */
function codeSpan(value: string): string {
  const flat = value.replace(/[\r\n]+/g, ' ');
  const ticks = '`'.repeat(longestBacktickRun(flat) + 1);
  const padded = flat.startsWith('`') || flat.endsWith('`') ? ` ${flat} ` : flat;
  return `${ticks}${padded}${ticks}`;
}

/** A table cell: pipes escaped, newlines collapsed, wrapped in a code span. */
function cell(value: string): string {
  const flat = value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
  return codeSpan(flat);
}

/** Prose text: backslashes/backticks escaped, newlines collapsed. */
function text(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Heading text: a leading `#` is escaped so it cannot start a new heading. */
function heading(value: string): string {
  const cleaned = value.replace(/[\r\n]+/g, ' ').trim();
  return cleaned.startsWith('#') ? `\\${cleaned}` : cleaned;
}

/** A fenced code block whose fence is longer than any backtick run in `body`. */
function fenced(body: string, language = ''): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
  return `${fence}${language}\n${body}\n${fence}`;
}

/** A Markdown table from a header row and already-`cell`-escaped body rows. */
function table(headers: readonly string[], rows: readonly string[][]): string {
  const header = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => ':---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Derivation helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Group the report's files by top-level segment, sorted deterministically. */
function topLevelGroups(files: readonly string[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const path of files) {
    const slash = path.indexOf('/');
    const group = slash === -1 ? '(root)' : path.slice(0, slash);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

interface TreeNode {
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(paths: readonly string[]): TreeNode {
  const root: TreeNode = { children: new Map(), isFile: false };
  for (const path of [...paths].sort()) {
    const segments = path.split('/');
    let node = root;
    segments.forEach((segment, index) => {
      let child = node.children.get(segment);
      if (!child) {
        child = { children: new Map(), isFile: false };
        node.children.set(segment, child);
      }
      if (index === segments.length - 1) {
        child.isFile = true;
      }
      node = child;
    });
  }
  return root;
}

function renderTree(node: TreeNode, indent: string): string[] {
  const lines: string[] = [];
  for (const name of [...node.children.keys()].sort()) {
    const child = node.children.get(name)!;
    const directory = child.children.size > 0 && !child.isFile;
    lines.push(`${indent}${name}${directory ? '/' : ''}`);
    lines.push(...renderTree(child, `${indent}  `));
  }
  return lines;
}

/** True when a route/component section should be emitted. */
function hasAny(values: readonly unknown[]): boolean {
  return values.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Document builders                                                          */
/* -------------------------------------------------------------------------- */

function buildReadme(input: DocGenerationInput): string {
  const { projectName, targetFramework, targetUrl, description, report } = input;
  const lines: string[] = [`# ${heading(projectName)}`];

  if (description !== undefined && description.trim().length > 0) {
    lines.push('', `> ${text(description)}`);
  }

  lines.push('', '## Overview', '');
  lines.push(`- Project: ${codeSpan(text(projectName))}`);
  lines.push(`- Framework: ${codeSpan(text(targetFramework))}`);
  if (targetUrl !== undefined && targetUrl.trim().length > 0) {
    lines.push(`- Source: ${codeSpan(text(targetUrl))}`);
  }

  lines.push('', '## Getting Started', '', '### Prerequisites', '');
  lines.push('- Node.js 20 or newer');
  lines.push('- npm (bundled with Node.js)');
  lines.push(`- ${text(targetFramework)}`);

  lines.push('', '### Install', '', fenced('npm install', 'bash'));

  const scripts: string[] = [];
  if (report.files.includes('vite.config.ts')) {
    scripts.push('npm run dev', 'npm run build');
  }
  if (report.files.includes('index.html')) {
    scripts.push('npm run preview');
  }
  if (scripts.length > 0) {
    lines.push('', '### Scripts', '', fenced(scripts.join('\n'), 'bash'));
  }

  const groups = topLevelGroups(report.files);
  if (groups.length > 0) {
    lines.push('', '## Project Structure', '');
    for (const group of groups) {
      const label = group.name === '(root)' ? '(root)' : `${group.name}/`;
      lines.push(`- ${codeSpan(label)} - ${group.count} file${group.count === 1 ? '' : 's'}`);
    }
  }

  if (hasAny(report.routes)) {
    lines.push('', '## Routes', '');
    lines.push(
      table(
        ['Path', 'Component', 'File', 'Auth', 'Index'],
        report.routes.map((route) => [
          cell(route.path),
          cell(route.component),
          cell(route.fileName),
          cell(route.authRequired ? 'yes' : 'no'),
          cell(route.index ? 'yes' : 'no')
        ])
      )
    );
  }

  if (hasAny(report.components)) {
    lines.push('', '## Components', '');
    lines.push(
      table(
        ['Name', 'Path'],
        report.components.map((component) => [cell(component.name), cell(component.path)])
      )
    );
  }

  if (report.files.includes('src/tokens.ts')) {
    lines.push(
      '',
      '## Design Tokens',
      '',
      `Design tokens were derived from the source Blueprint and written to ${codeSpan('src/tokens.ts')} and ${codeSpan('src/styles/index.css')}. Values are not restated here to avoid drift.`
    );
  }

  lines.push(
    '',
    '## Generated by Artupski ReSite',
    '',
    'This documentation was generated deterministically from the project generation report. Only routes, components, and assets that were actually generated are listed.'
  );

  return `${lines.join('\n')}\n`;
}

function buildArchitecture(input: DocGenerationInput): string {
  const { projectName, targetFramework, targetUrl, report } = input;
  const lines: string[] = [`# Architecture - ${heading(projectName)}`];

  lines.push('', '## Overview', '');
  lines.push(`- Framework: ${codeSpan(text(targetFramework))}`);
  if (targetUrl !== undefined && targetUrl.trim().length > 0) {
    lines.push(`- Source: ${codeSpan(text(targetUrl))}`);
  }

  lines.push(
    '',
    '## Technology Stack',
    '',
    `The generated project targets ${text(targetFramework)}. It is a self-contained, standalone application that does not depend on Artupski ReSite at runtime.`
  );

  if (hasAny(report.files)) {
    const tree = renderTree(buildTree(report.files), '').join('\n');
    lines.push('', '## Directory Layout', '', fenced(tree, 'text'));
  }

  if (hasAny(report.routes)) {
    lines.push('', '## Routing', '');
    lines.push(
      table(
        ['Path', 'Component', 'File', 'Auth', 'Index'],
        report.routes.map((route) => [
          cell(route.path),
          cell(route.component),
          cell(route.fileName),
          cell(route.authRequired ? 'yes' : 'no'),
          cell(route.index ? 'yes' : 'no')
        ])
      )
    );
    if (hasAny(report.droppedRoutes)) {
      lines.push(
        '',
        'The following routes were dropped during generation and are not part of the project:',
        ''
      );
      for (const dropped of report.droppedRoutes) {
        lines.push(`- ${cell(dropped.path)} - ${text(dropped.reason)}`);
      }
    }
  }

  if (hasAny(report.components)) {
    lines.push(
      '',
      '## Components',
      '',
      `${report.components.length} component(s) were assembled.`,
      ''
    );
    lines.push(
      table(
        ['Name', 'Path'],
        report.components.map((component) => [cell(component.name), cell(component.path)])
      )
    );
  }

  if (hasAny(report.assets)) {
    lines.push('', '## Assets', '');
    lines.push(
      table(
        ['Id', 'Path'],
        report.assets.map((asset) => [cell(asset.id), cell(asset.path)])
      )
    );
  }

  lines.push(
    '',
    '## Build Pipeline',
    '',
    'The project builds with its own toolchain:',
    '',
    fenced('npm run build', 'bash'),
    '',
    `Output is written to ${codeSpan('dist/')}. This is the generated project's own step; Artupski ReSite does not execute it during export.`
  );

  return `${lines.join('\n')}\n`;
}

function buildComponents(input: DocGenerationInput): string {
  const { projectName, report } = input;
  const lines: string[] = [`# Components - ${heading(projectName)}`];

  lines.push('', '## Summary', '');
  lines.push(`- Components: ${report.summary.componentsWritten}`);
  lines.push(`- Pages: ${report.summary.routesWritten}`);
  lines.push(`- Assets: ${report.summary.assetsWritten}`);
  lines.push(`- Files: ${report.summary.filesWritten}`);

  lines.push('', '## Components', '');
  if (hasAny(report.components)) {
    lines.push(
      table(
        ['Name', 'Path'],
        report.components.map((component) => [cell(component.name), cell(component.path)])
      )
    );
  } else {
    lines.push('No components were generated.');
  }

  if (hasAny(report.routes)) {
    lines.push('', '## Pages', '');
    lines.push(
      table(
        ['Route', 'Component', 'File'],
        report.routes.map((route) => [
          cell(route.path),
          cell(route.component),
          cell(route.fileName)
        ])
      )
    );
  }

  const hooks = report.files.filter((path) => path.startsWith('src/hooks/'));
  if (hooks.length > 0) {
    lines.push('', '## Hooks', '');
    for (const hook of [...hooks].sort()) {
      lines.push(`- ${cell(hook)}`);
    }
  }

  if (hasAny(report.assets)) {
    lines.push('', '## Assets', '');
    lines.push(
      table(
        ['Id', 'Path'],
        report.assets.map((asset) => [cell(asset.id), cell(asset.path)])
      )
    );
  }

  lines.push(
    '',
    '## Conventions',
    '',
    '- Components use PascalCase identifiers.',
    '- One component per file.'
  );

  return `${lines.join('\n')}\n`;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generate the three Markdown documents. Always returns a result; never throws.
 * A document over `MAX_EXPORT_DOC_BYTES` is refused and reported rather than
 * emitted, making `ok: false` with an actionable error.
 */
export function generateDocs(input: DocGenerationInput): DocGenerationResult {
  const builders: { name: GeneratedDocName; build: () => string }[] = [
    { name: 'README.md', build: () => buildReadme(input) },
    { name: 'ARCHITECTURE.md', build: () => buildArchitecture(input) },
    { name: 'COMPONENTS.md', build: () => buildComponents(input) }
  ];

  const docs: GeneratedDoc[] = [];
  const skipped: ExportFailure[] = [];

  for (const { name, build } of builders) {
    const contents = build();
    const bytes = utf8Bytes(contents);
    if (bytes > MAX_EXPORT_DOC_BYTES) {
      skipped.push({
        kind: 'doc',
        id: name,
        code: 'EXPORT_DOC_TOO_LARGE',
        message: `Document ${JSON.stringify(name)} is ${bytes} bytes and exceeds the ${MAX_EXPORT_DOC_BYTES}-byte cap.`
      });
      continue;
    }
    docs.push({ name, contents, bytes });
  }

  if (skipped.length > 0) {
    return { ok: false, docs, skipped, error: skipped[0]! };
  }
  return { ok: true, docs, skipped };
}
