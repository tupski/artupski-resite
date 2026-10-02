/**
 * Clone manifest builder - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md section 2 (`manifest.json`).
 *
 * Pure helpers that assemble the `manifest.json` document describing the clone:
 * the route map (original URL -> local file) and the asset list. Keeping this
 * pure makes it directly unit-testable and keeps all I/O in the clone service.
 */
import type { CloneManifest, CloneManifestAsset, CloneManifestRoute } from '../../types/clone';

export interface BuildManifestInput {
  sourceOrigin: string;
  generatedAt: string;
  routes: CloneManifestRoute[];
  assets: CloneManifestAsset[];
  skippedPageCount: number;
}

/** Build the manifest document from already-assembled route + asset lists. */
export function buildManifest(input: BuildManifestInput): CloneManifest {
  return {
    generatedAt: input.generatedAt,
    sourceOrigin: input.sourceOrigin,
    pageCount: input.routes.length,
    assetCount: input.assets.length,
    skippedPageCount: input.skippedPageCount,
    routes: [...input.routes].sort((a, b) => a.url.localeCompare(b.url)),
    assets: [...input.assets].sort((a, b) => a.localPath.localeCompare(b.localPath))
  };
}

/** Serialize the manifest deterministically (2-space indent, trailing newline). */
export function serializeManifest(manifest: CloneManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
