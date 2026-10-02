/**
 * Clone service public surface - Artupski ReSite
 *
 * Everything above the clone layer imports from here. The pure rewriter modules
 * are exported for tests; the factories are the live wiring.
 */
export {
  CloneService,
  DEFAULT_CLONE_MAX_PAGES,
  type CloneFileIo,
  type ClonePersistence,
  type CloneRequest,
  type CloneResult,
  type CloneServiceDeps,
  type CloneWorker,
  type CapturedAssetLike
} from './cloneService';
export {
  createCloneService,
  createCloneWorker,
  createIpcCloneFileIo,
  createStorageClonePersistence
} from './cloneFactory';
export {
  startLocalServer,
  stopLocalServer,
  type CloneServerAdapter,
  type CloneServerOptions,
  type LocalServerHandle,
  type LocalServerResult
} from './localServer';
export {
  assetDirForType,
  assetPathFor,
  extensionFromUrl,
  isSafeRelativePath,
  pagePathForUrl,
  relativeFromCss,
  relativeFromPage,
  slugifySegment
} from './clonePaths';
export { rewriteHtml, type HtmlRewriteOptions } from './htmlRewriter';
export { rewriteCss, type CssRewriteOptions } from './cssRewriter';
export { MOCK_CLIENT_JS } from './mockClient';
export { buildManifest, serializeManifest, type BuildManifestInput } from './manifest';
export { contentTypeFor, normalizeRoot, resolveServePath } from './serverPathPolicy';
