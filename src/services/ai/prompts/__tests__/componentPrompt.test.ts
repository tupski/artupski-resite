import { describe, expect, it } from 'vitest';
import { COMPONENT_TASK_INSTRUCTION, buildComponentSystemPrompt } from '../componentPrompt';
import { SYSTEM_PROMPT_BASE } from '../systemPrompt';

describe('componentPrompt (Phase 11 prompt engineering + injection isolation, A6)', () => {
  it('always prepends the AI-SPEC 5.1 security directives', () => {
    const prompt = buildComponentSystemPrompt();
    expect(prompt.startsWith(SYSTEM_PROMPT_BASE)).toBe(true);
    expect(prompt).toContain('SECURITY DIRECTIVES');
    expect(prompt).toContain('<DATA_PAYLOAD>');
  });

  it('contains a task section authored by the application', () => {
    const prompt = buildComponentSystemPrompt();
    expect(prompt).toContain('TASK:');
    expect(prompt).toContain(COMPONENT_TASK_INSTRUCTION.slice(0, 40));
  });

  it('instructs the model to return strict JSON (structured output)', () => {
    expect(COMPONENT_TASK_INSTRUCTION).toContain('STRICT JSON');
    expect(COMPONENT_TASK_INSTRUCTION).toContain('componentId');
    expect(COMPONENT_TASK_INSTRUCTION.toLowerCase()).toContain('tailwind');
  });

  it('forbids AI-slop constructs explicitly', () => {
    for (const forbidden of ['TODO', 'console', 'any', 'conversational']) {
      expect(COMPONENT_TASK_INSTRUCTION.toLowerCase()).toContain(forbidden.toLowerCase());
    }
  });

  it('never embeds untrusted evidence in the instruction (no payload here)', () => {
    // The prompt builder takes no evidence argument by design.
    expect(COMPONENT_TASK_INSTRUCTION).not.toContain('example.com');
  });
});
