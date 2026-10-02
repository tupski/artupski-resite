/**
 * Visual verification engine - public surface - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-13-impl-plan.md sections 7-8.
 *
 * Consumers import from here; the internal modules stay private. The pure core
 * (`computeVisualDiff`), the PNG codec, the managed generated-project server, and
 * the orchestrating service are all re-exported for callers and tests.
 */
export {
  runVisualDiff,
  joinUrl,
  MAX_DIFF_ROUTES,
  type DiffCaptureAdapter,
  type DiffOriginalReader,
  type DiffServerLauncher,
  type GeneratedRouteTarget,
  type OriginalCaptureRef,
  type VisualDiffRunRequest,
  type VisualDiffServiceDeps
} from './diffService';

export { computeVisualDiff, isRgbaImage } from './visualDiff';

export { decodePng, encodePng, PngError } from './png';

export {
  resolveGeneratedServeRoot,
  startGeneratedServer,
  stopGeneratedServer,
  reportGeneratedServerFailure,
  type GeneratedServerAdapter,
  type GeneratedServerHandle,
  type GeneratedServerOptions,
  type GeneratedServerResult
} from './generatedServer';

export { resolveGeneratedServePath, normalizeRoot } from './diffPaths';
