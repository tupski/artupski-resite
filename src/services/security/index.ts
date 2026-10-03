/**
 * Security services - public surface - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-15-impl-plan.md section 10.
 *
 * Consumers import from here; the native IPC details and the `redactSecrets`
 * implementation stay private so later phases depend on this contract, not on
 * a specific keychain backend.
 */
export {
  isValidSecretAccount,
  secretAvailable,
  getSecret,
  setSecret,
  deleteSecret,
  type SecretRef,
  type SecretResult,
  type SecretMutationResult
} from './keychain';

export { scrubSecrets, createRedactingSink, REDACTED_PLACEHOLDER } from './redaction';
