/**
 * Form/state representation tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 11.
 */
import { describe, expect, it } from 'vitest';
import { buildForms, toForm, toFormField } from '../forms';
import { fixtureEvidence, model } from './fixtures';

describe('buildForms', () => {
  it('maps captured fields, options, and validation attributes (never values)', () => {
    const forms = buildForms([model(fixtureEvidence())]);
    expect(forms).toHaveLength(1);
    const form = forms[0];
    expect(form?.method).toBe('POST');
    expect(form?.action_endpoint).toBe('/api/v1/contact');
    expect(form?.submit_button_label).toBe('Submit Request');
    const fullName = form?.fields.find((field) => field.name === 'full_name');
    expect(fullName?.required).toBe(true);
    expect(fullName?.placeholder).toBe('Jane Doe');
    expect(fullName?.validations?.map((validation) => validation.rule)).toContain('min_length');
    const companySize = form?.fields.find((field) => field.name === 'company_size');
    expect(companySize?.options?.[0]).toEqual({ label: '1-10 employees', value: '1-10' });
  });

  it('never emits an input value even when the fixture carries one', () => {
    const forms = buildForms([model(fixtureEvidence())]);
    const serialized = JSON.stringify(forms);
    expect(serialized).not.toContain('INPUT_SECRET_VALUE_XYZ');
    expect(serialized).not.toContain('LOCAL_SECRET_TOKEN_XYZ');
  });

  it('normalizes an unknown method to GET rather than inventing one', () => {
    const form = toForm(
      {
        id: 'f',
        name: 'newsletter',
        method: 'PATCH',
        action: '/subscribe',
        submitButtonLabel: 'Go',
        fields: []
      },
      0
    );
    expect(form.method).toBe('GET');
  });

  it('falls back to the field name when no label is observed', () => {
    const field = toFormField({
      name: 'email',
      label: '',
      type: 'email',
      required: false,
      placeholder: null,
      options: [],
      validations: {}
    });
    expect(field.label).toBe('email');
    expect(field.placeholder).toBeUndefined();
    expect(field.options).toBeUndefined();
  });

  it('returns an empty list when there is no form evidence', () => {
    expect(buildForms([model({})])).toEqual([]);
  });

  it('is deterministic for identical evidence', () => {
    const first = buildForms([model(fixtureEvidence())]);
    const second = buildForms([model(fixtureEvidence())]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
