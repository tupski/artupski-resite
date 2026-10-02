/**
 * Form / state representation - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.5 and
 * docs/specs/BLUEPRINT-SPEC.md section 2.12.
 *
 * Builds the `forms[]` section from the bounded, captured form descriptors
 * (fields, labels, types, required, options, placeholders, HTML validation
 * attributes). Field VALUES are never read or emitted, and no backend state or
 * business logic is reconstructed - only what the DOM structurally exposes.
 *
 * There is no dedicated `state` section in the spec (decision C10): client state
 * is represented through component variants and interactions, not here.
 */
import type { BlueprintForm, BlueprintFormField } from '../../types/blueprint';
import type { BlueprintEvidenceForm } from '../infra/workerProtocol';
import type { EvidenceModel } from './evidence';
import { ProvenanceCollector } from './evidence';
import { slugify } from './util';

const VALID_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'DELETE']);

/** Map a captured validation attribute to the spec's rule name. */
const VALIDATION_RULES: Record<string, string> = {
  pattern: 'pattern',
  min: 'min',
  max: 'max',
  minlength: 'min_length',
  maxlength: 'max_length',
  step: 'step'
};

function normalizeMethod(method: string): BlueprintForm['method'] {
  const upper = method.toUpperCase();
  return (VALID_METHODS.has(upper) ? upper : 'GET') as BlueprintForm['method'];
}

function fieldValidations(validations: Record<string, string>): BlueprintFormField['validations'] {
  const out: NonNullable<BlueprintFormField['validations']> = [];
  for (const key of Object.keys(validations).sort()) {
    const rule = VALIDATION_RULES[key] ?? key;
    const raw = validations[key];
    if (raw === undefined) {
      continue;
    }
    const numeric = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
    out.push({
      rule,
      ...(numeric !== null ? { value: numeric } : {}),
      message: `Field must satisfy ${rule}.`
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Convert one captured field into a spec field (never a value). */
export function toFormField(field: BlueprintEvidenceForm['fields'][number]): BlueprintFormField {
  const label = field.label.length > 0 ? field.label : field.name;
  const result: BlueprintFormField = {
    name: field.name,
    label,
    type: field.type.length > 0 ? field.type : 'text',
    required: field.required
  };
  if (field.placeholder !== null && field.placeholder.length > 0) {
    result.placeholder = field.placeholder;
  }
  if (field.options.length > 0) {
    result.options = field.options.map((option) => ({ label: option.label, value: option.value }));
  }
  const validations = fieldValidations(field.validations);
  if (validations) {
    result.validations = validations;
  }
  return result;
}

/** Convert one captured form descriptor into a spec form. */
export function toForm(form: BlueprintEvidenceForm, index: number): BlueprintForm {
  const name = form.name.length > 0 ? form.name : form.id.length > 0 ? form.id : `form_${index}`;
  return {
    id: `form_${slugify(name) || `form_${index}`}`,
    name,
    method: normalizeMethod(form.method),
    action_endpoint: form.action,
    fields: form.fields.map(toFormField),
    submit_button_label: form.submitButtonLabel
  };
}

/**
 * Build the forms section from every page's captured form evidence. Forms are
 * merged deterministically (page URL, then evidence order) with a stable
 * de-duplication key so the same observed form is not emitted twice.
 */
export function buildForms(
  models: readonly EvidenceModel[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintForm[] {
  const ordered = [...models].sort((a, b) => a.url.localeCompare(b.url));
  const forms: BlueprintForm[] = [];
  const seen = new Set<string>();

  for (const model of ordered) {
    model.forms.forEach((raw, index) => {
      const key = `${raw.method.toUpperCase()}|${raw.action}|${raw.name || raw.id}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const form = toForm(raw, index);
      forms.push(form);
      collector.addObservation({
        kind: 'form',
        ref: form.id,
        source: `evidence_form:${model.pageId}`
      });
    });
  }

  return forms;
}
