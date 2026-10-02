/**
 * Blueprint service wiring - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 8.1.
 *
 * Wires the pure Blueprint synthesis orchestrator to the live sandboxed
 * evidence-read seam. It performs READ-ONLY work: no persistence, no events, no
 * UI. The frontend never supplies a filesystem path - only the stored evidence
 * id is used, and the Rust `blueprint_read` command enforces the sandbox.
 */
import { blueprintRead } from '../ipc';
import { isTauriRuntime } from '../ipc/tauri';
import { evidenceIdFromPath, type EvidenceIo } from './evidence';

/** Production evidence IO over the sandboxed Rust `blueprint_read` command. */
export const defaultEvidenceIo: EvidenceIo = {
  async read(path) {
    if (!isTauriRuntime()) {
      return null;
    }
    const id = evidenceIdFromPath(path);
    if (!id) {
      return null;
    }
    const result = await blueprintRead(id);
    if (!result.ok) {
      return null;
    }
    return Uint8Array.from(result.data);
  }
};
