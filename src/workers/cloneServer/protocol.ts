/**
 * Clone preview server protocol accessor - Artupski ReSite
 *
 * The preview server is a dedicated, `ProcessManager`-managed Node child that
 * reuses the shared envelope codec (`src/services/infra/workerProtocol.ts`) with
 * its own small command set. This module is the single import seam so the worker
 * and the host share one definition and the wire contract cannot drift.
 */
export {
  WORKER_PROTOCOL_VERSION,
  decodeFrames,
  parseMessage,
  serializeMessage,
  createResultMessage,
  createEventMessage,
  createLogMessage,
  createErrorMessage,
  createMessageId
} from '../../services/infra/workerProtocol.ts';

export type {
  WorkerMessage,
  WorkerCommandMessage,
  WorkerResultPayload
} from '../../services/infra/workerProtocol.ts';

// The path-confinement policy is shared verbatim with the host so the served
// root can never be escaped on either side.
export {
  resolveServePath,
  contentTypeFor,
  normalizeRoot
} from '../../services/clone/serverPathPolicy.ts';
