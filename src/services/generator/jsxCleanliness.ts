/**
 * JSX cleanliness optimizer - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 11 "JSX cleanliness optimizer" and
 * task 3 "Ensure no AI-slop code or useless comments are generated") and
 * docs/impl-plan/phase-11-impl-plan.md sections 7, 11.
 *
 * This module is deterministic and dependency-free. It provides:
 *   - `validateTsxStructure`: bounded structural validation of generated TSX
 *     (balanced braces/JSX, a single component declaration, an identifier, no
 *     unsafe constructs) WITHOUT executing it.
 *   - `assessCleanliness`: detects AI-slop (filler prose, useless comments,
 *     `any`/`@ts-ignore`, `console.*`, empty handlers, leftover imports).
 *   - `optimizeJsx`: a conservative normalizer (indentation, blank-line collapse,
 *     import order) that NEVER rewrites logic.
 *
 * A component is only accepted when BOTH structure and cleanliness pass. The
 * optimizer only runs on an already-clean artifact.
 */
import { MAX_TSX_BRACE_DEPTH } from '../../types/componentSynth';

export interface TsxAssessment {
  clean: boolean;
  /** Stable, human-readable violation codes (never code content). */
  violations: string[];
}

/* -------------------------------------------------------------------------- */
/* Structural validation                                                      */
/* -------------------------------------------------------------------------- */

const FORBIDDEN_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'SCRIPT_TAG', pattern: /<\s*script\b/i },
  { code: 'DANGEROUS_HTML', pattern: /dangerouslySetInnerHTML/ },
  { code: 'EVAL_USAGE', pattern: /\beval\s*\(/ },
  { code: 'FUNCTION_CONSTRUCTOR', pattern: /\bnew\s+Function\s*\(/ },
  { code: 'REQUIRE_USAGE', pattern: /\brequire\s*\(/ },
  { code: 'DYNAMIC_IMPORT', pattern: /\bimport\s*\(/ },
  { code: 'PROCESS_ENV', pattern: /\bprocess\.env\b/ },
  { code: 'DOCUMENT_WRITE', pattern: /\bdocument\.write\s*\(/ },
  { code: 'STYLE_TAG', pattern: /<\s*style\b/i },
  { code: 'GLOBAL_WINDOW_ACCESS', pattern: /\bwindow\[/ }
];

/** Patterns that are AI-slop or forbidden by the authoring contract. */
const SLOP_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'CONVERSATIONAL_FILLER', pattern: /^(Here|Sure|Certainly|Of course)\b/im },
  { code: 'MARKDOWN_FENCE', pattern: /```/ },
  { code: 'TODO_COMMENT', pattern: /\/\/\s*(?:TODO|FIXME|XXX)\b/i },
  { code: 'PLACEHOLDER_COMMENT', pattern: /\/\/\s*(?:rest of|existing|your)\b/i },
  { code: 'BLOCK_COMMENT', pattern: /\/\*[\s\S]*?\*\// },
  { code: 'ANY_TYPE', pattern: /:\s*any\b/ },
  { code: 'TS_IGNORE', pattern: /@ts-(?:ignore|nocheck|expect-error)/ },
  { code: 'NON_NULL_ASSERTION', pattern: /[A-Za-z0-9_)\]]\s*!\s*[.,;)]/ },
  { code: 'CONSOLE_CALL', pattern: /\bconsole\.\w+\s*\(/ },
  { code: 'DEBUGGER', pattern: /\bdebugger\b/ },
  { code: 'ALERT_CALL', pattern: /\balert\s*\(/ },
  { code: 'EMPTY_HANDLER', pattern: /=>\s*\{\s*\}/ }
];

const IDENTIFIER = /^[A-Z][A-Za-z0-9]*$/;

/** Validate the TSX structure of generated code (no execution, bounded). */
export function validateTsxStructure(code: string, name: string): TsxAssessment {
  const violations: string[] = [];

  if (!code.trim()) {
    return { clean: false, violations: ['EMPTY_CODE'] };
  }
  if (!IDENTIFIER.test(name)) {
    violations.push('INVALID_IDENTIFIER');
  }

  for (const { code: violation, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      violations.push(violation);
    }
  }

  if (!hasBalancedDelimiters(code)) {
    violations.push('UNBALANCED_DELIMITERS');
  } else if (maxBraceDepth(code) > MAX_TSX_BRACE_DEPTH) {
    violations.push('EXCESSIVE_NESTING');
  }

  if (!declaresComponent(code, name)) {
    violations.push('MISSING_COMPONENT_DECLARATION');
  }

  return { clean: violations.length === 0, violations };
}

/** True when every bracket/paren/brace pair is balanced (bounded scan). */
export function hasBalancedDelimiters(code: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const char of code) {
    if (char === '(' || char === '[' || char === '{') {
      stack.push(char);
    } else if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== pairs[char]) {
        return false;
      }
    }
  }
  return stack.length === 0;
}

/** Maximum achieved brace depth (used to reject pathological nesting). */
export function maxBraceDepth(code: string): number {
  let depth = 0;
  let max = 0;
  for (const char of code) {
    if (char === '{') {
      depth += 1;
      max = Math.max(max, depth);
    } else if (char === '}') {
      depth -= 1;
    }
  }
  return max;
}

/**
 * True when the code declares the expected component identifier, either as a
 * `function Name(` declaration or an `const Name ... =>` arrow component.
 */
export function declaresComponent(code: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fnDecl = new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`);
  const arrowDecl = new RegExp(`\\b(?:const|let)\\s+${escaped}\\s*[=:]`);
  return fnDecl.test(code) || arrowDecl.test(code);
}

/* -------------------------------------------------------------------------- */
/* Cleanliness assessment                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Detect AI-slop and contract violations. Comments of any kind are rejected
 * (PLAN.md: "no useless comments"); genuine JSDoc is not needed for generated
 * primitives and a blanket ban keeps the check objective and deterministic.
 */
export function assessCleanliness(code: string): TsxAssessment {
  const violations: string[] = [];

  for (const { code: violation, pattern } of SLOP_PATTERNS) {
    if (pattern.test(code)) {
      violations.push(violation);
    }
  }

  if (hasUnusedImports(code)) {
    violations.push('UNUSED_IMPORT');
  }

  return { clean: violations.length === 0, violations };
}

/** Best-effort unused-import detection (single-identifier default/named imports). */
export function hasUnusedImports(code: string): boolean {
  const importRe = /import\s+(?:type\s+)?([^'";]+?)\s+from\s+['"][^'"]+['"];?/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(code)) !== null) {
    const clause = match[1] ?? '';
    for (const local of importedNames(clause)) {
      // Count references outside the import statement itself.
      const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const body = code.replace(match[0], '');
      const refRe = new RegExp(`\\b${escaped}\\b`, 'g');
      if (!refRe.test(body)) {
        return true;
      }
    }
  }
  return false;
}

/** Extract the local binding names introduced by an import clause. */
function importedNames(clause: string): string[] {
  const names: string[] = [];
  const trimmed = clause.trim();

  // `React`, `React as R`, `* as R`
  const star = trimmed.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
  if (star) {
    return [star[1] as string];
  }

  const braceStart = trimmed.indexOf('{');
  const defaultPart = braceStart >= 0 ? trimmed.slice(0, braceStart) : trimmed;
  const defaultName = defaultPart.trim().replace(/,$/, '').trim();
  if (defaultName && /^[A-Za-z_$][\w$]*$/.test(defaultName)) {
    names.push(defaultName);
  } else {
    const asMatch = defaultName.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
    if (asMatch) {
      names.push(asMatch[1] as string);
    }
  }

  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    const inner = trimmed.slice(braceStart + 1, braceEnd);
    for (const piece of inner.split(',')) {
      const named = piece.trim();
      if (!named) {
        continue;
      }
      const asMatch = named.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        names.push(asMatch[1] as string);
      } else if (/^[A-Za-z_$][\w$]*$/.test(named)) {
        names.push(named);
      }
    }
  }

  return names;
}

/* -------------------------------------------------------------------------- */
/* Conservative optimizer                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Normalize whitespace and import order deterministically. This is intentionally
 * conservative: it trims trailing whitespace, converts tabs to two spaces,
 * collapses runs of blank lines to a single blank line, ensures the file ends in
 * a single newline, and sorts IMPORT lines alphabetically. It never touches the
 * body's logic or JSX.
 */
export function optimizeJsx(code: string): string {
  const lines = code.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');

  // Partition leading import block from the remainder.
  const imports: string[] = [];
  const rest: string[] = [];
  let seenNonImport = false;
  for (const line of lines) {
    if (!seenNonImport && /^\s*import\b/.test(line)) {
      imports.push(line.trimEnd());
    } else {
      if (line.trim() !== '') {
        seenNonImport = true;
      }
      rest.push(line.trimEnd());
    }
  }

  const sortedImports = [...imports].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const collapsed: string[] = [];
  let blank = false;
  for (const line of rest) {
    if (line.trim() === '') {
      if (!blank && collapsed.length > 0) {
        collapsed.push('');
      }
      blank = true;
    } else {
      collapsed.push(line);
      blank = false;
    }
  }

  const body = [...sortedImports, ...(sortedImports.length > 0 ? [''] : []), ...collapsed]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');

  return `${body}\n`;
}

/**
 * Full acceptance gate for a generated component: structural validation AND
 * cleanliness. Returns the combined, de-duplicated violations.
 */
export function evaluateGeneratedComponent(
  code: string,
  name: string
): TsxAssessment & { optimized?: string } {
  const structure = validateTsxStructure(code, name);
  const cleanliness = assessCleanliness(code);
  const violations = [...new Set([...structure.violations, ...cleanliness.violations])];
  if (violations.length > 0) {
    return { clean: false, violations };
  }
  return { clean: true, violations: [], optimized: optimizeJsx(code) };
}
