/**
 * Scripted component-synthesis engine - Artupski ReSite (Phase 16 E2E)
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md sections 8.1 and 9.
 *
 * The E2E pipeline composes the REAL Phase 9 Blueprint engine, the REAL Phase 11
 * synthesis orchestrator, the REAL Phase 12 generator, and the REAL Phase 14
 * exporter. Only the AI PROVIDER is replaced - by a deterministic scripted engine
 * - because the E2E must not touch a network or an API key. This is the same
 * seam the Phase 11 unit suite injects (`ComponentSynthesisEngine`); no product
 * code is mocked.
 *
 * The engine reads the bounded per-component payload the orchestrator builds
 * (`component_id`, `target_identifier`, required `props`) and emits a clean TSX
 * artifact that:
 *   - declares a component named exactly `target_identifier`,
 *   - accepts the REQUIRED Blueprint props (so the generated page type-checks),
 *   - passes the Phase 11 cleanliness gate (no comments/`any`/console/unused).
 */
import type { GenerationTask } from '../../src/types/ai';
import type { ComponentSynthesisEngine } from '../../src/services/generator/componentSynthesizer';
import type { PipelineResult } from '../../src/services/ai';
import { createAiError } from '../../src/services/ai/errors';

interface ScriptedPayload {
  component_id: string;
  name: string;
  target_identifier: string;
  props?: Array<{ name: string; type: string; required: boolean; options?: string[] }>;
}

/** A TS type that accepts the neutral value `renderRequiredProps` emits. */
function tsType(prop: { type: string }): string {
  switch (prop.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return 'string';
    case 'array':
      return 'string[]';
    case 'object':
      return 'Record<string, unknown>';
    default:
      return 'string';
  }
}

/** Render a clean, deterministic component that declares and renders its props. */
export function renderComponentCode(
  name: string,
  required: ReadonlyArray<{ name: string; type: string }>
): string {
  if (required.length === 0) {
    return `export function ${name}() {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <p className="text-sm text-slate-600">${name}</p>
    </div>
  );
}
`;
  }
  const fields = required.map((prop) => `  ${prop.name}: ${tsType(prop)};`).join('\n');
  const body = required
    .map((prop) => `      <span>{JSON.stringify(props.${prop.name})}</span>`)
    .join('\n');
  return `interface ${name}Props {
${fields}
}

export function ${name}(props: ${name}Props) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-4">
${body}
    </div>
  );
}
`;
}

/**
 * Build a deterministic engine that satisfies the Phase 11 output contract for
 * every requested component. It never performs I/O and never throws.
 */
export function createScriptedEngine(): ComponentSynthesisEngine {
  return {
    async generate<T>(task: GenerationTask<T>): Promise<PipelineResult<T>> {
      const payload = task.payload as unknown as ScriptedPayload;
      const name = payload.target_identifier;
      const required = (payload.props ?? []).filter((prop) => prop.required);
      const code = renderComponentCode(name, required);

      const parsed = task.schema.safeParse({
        componentId: payload.component_id,
        name,
        fileName: `${name}.tsx`,
        code
      });
      if (!parsed.success) {
        return {
          ok: false,
          error: createAiError(
            'MALFORMED_OUTPUT',
            'The scripted engine produced a component that failed the output contract.'
          ),
          attempts: 1
        };
      }
      return { ok: true, data: parsed.data as T, attempts: 1 };
    }
  };
}
