/**
 * Worker protocol accessor - Artupski ReSite
 *
 * The worker and the host MUST share one protocol definition so the wire
 * contract cannot drift. This module re-exports the host protocol
 * (`src/services/infra/workerProtocol.ts`) with `.ts`-explicit imports so the
 * dedicated Node process can resolve it via native type stripping.
 *
 * No protocol logic lives here - it is a single, obvious seam.
 */
export {
  WORKER_PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  serializeMessage,
  parseMessage,
  validateMessage,
  decodeFrames,
  createResultMessage,
  createEventMessage,
  createLogMessage,
  createErrorMessage,
  createMessageId,
  stableStringify
} from '../../services/infra/workerProtocol.ts';

export type {
  WorkerCommandPayload,
  WorkerResultPayload,
  WorkerMessage,
  WorkerCommandMessage,
  WorkerEventPayload,
  WorkerLogPayload,
  BrowserEngine,
  BrowserAvailability,
  PingResultPayload,
  LaunchResultPayload,
  NavigateResultPayload,
  CloseResultPayload
} from '../../services/infra/workerProtocol.ts';
