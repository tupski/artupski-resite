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
  DEFAULT_EXTRACTABLE_CONTENT_TYPES,
  MAX_EXTRACT_REDIRECTS,
  serializeMessage,
  parseMessage,
  validateMessage,
  decodeFrames,
  createResultMessage,
  createEventMessage,
  createLogMessage,
  createErrorMessage,
  createMessageId,
  stableStringify,
  isAuthStorageState
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
  AuthStorageState,
  LoginDetectionSignals,
  PingResultPayload,
  LaunchResultPayload,
  NavigateResultPayload,
  CloseResultPayload,
  ExtractCommandPayload,
  ExtractResultPayload,
  AbortCommandPayload,
  AbortResultPayload,
  DetectLoginCommandPayload,
  DetectLoginResultPayload
} from '../../services/infra/workerProtocol.ts';

// Shared pure modules the worker enforces/uses directly. Re-exported here so the
// worker has a single import seam (mirroring the protocol re-export above).
export {
  evaluateUrlPolicy,
  screenUrlShape,
  MAX_REDIRECTS
} from '../../services/scanner/security/urlPolicy.ts';
export type {
  HostResolution,
  UrlPolicyDecision
} from '../../services/scanner/security/urlPolicy.ts';
export { createCrawlScope } from '../../services/scanner/crawlScope.ts';
export type { CrawlScope } from '../../services/scanner/crawlScope.ts';
export { normalizeUrl, resolveAndNormalize } from '../../services/scanner/normalization.ts';
export {
  normalizeExtraction,
  buildUnavailablePage
} from '../../services/scanner/extraction/normalize.ts';
export type {
  PageExtraction,
  NormalizedPage,
  LoginSignals
} from '../../services/scanner/extraction/types.ts';
export { createEmptyLoginSignals } from '../../services/scanner/extraction/types.ts';
export { classifyPageAuth } from '../../services/scanner/authClassifier.ts';
export { extractPageEvidence } from './extraction.ts';
export type { ExtractablePage } from './extraction.ts';
