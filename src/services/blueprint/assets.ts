/**
 * Asset registry projection - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.5 and
 * docs/specs/BLUEPRINT-SPEC.md section 2.8.
 *
 * Projects persisted `scan_assets` rows (images/fonts) and observed evidence
 * (`<img>` sources, `@font-face` declarations, icon-font class hints) into the
 * Blueprint `assets` section. Only metadata + the local path are used - asset
 * bytes never reach the Blueprint. Nothing is invented: an image asset requires
 * a real observed URL + sha256 from `scan_assets`.
 */
import type { CloneAsset } from '../../types/models';
import type {
  BlueprintAssets,
  BlueprintFontAsset,
  BlueprintIconAsset,
  BlueprintImageAsset
} from '../../types/blueprint';
import type { EvidenceModel } from './evidence';
import { ProvenanceCollector } from './evidence';
import { slugify } from './util';

const MAX_IMAGES = 500;
const MAX_ICONS = 200;

function imageIdFor(asset: CloneAsset, index: number): string {
  const base = asset.localPath
    .split('/')
    .pop()
    ?.replace(/\.[a-z0-9]+$/i, '');
  return `img_${slugify(base ?? asset.sha256.slice(0, 12)) || `image_${index}`}`;
}

function iconTypeFor(asset: CloneAsset): BlueprintIconAsset['type'] {
  return asset.mimeType.startsWith('image/svg') ? 'inline_svg' : 'image';
}

/** Well-known icon-font class prefixes observed on elements. */
const ICON_FONT_PREFIXES = [
  'fa-',
  'fas ',
  'far ',
  'fab ',
  'bi-',
  'mdi-',
  'material-icons',
  'glyphicon'
];

/** Extract icon-font glyph names from observed class tokens. */
function observedIconFonts(models: readonly EvidenceModel[]): BlueprintIconAsset[] {
  const glyphs = new Set<string>();
  for (const model of models) {
    for (const node of model.visibleNodes) {
      for (const token of node.classes) {
        const lower = token.toLowerCase();
        if (ICON_FONT_PREFIXES.some((prefix) => lower.startsWith(prefix.trim()))) {
          glyphs.add(token);
        }
      }
    }
  }
  return [...glyphs]
    .sort()
    .slice(0, MAX_ICONS)
    .map((glyph) => ({
      id: `icon_${slugify(glyph)}`,
      type: 'font_icon' as const,
      glyph_name: glyph
    }));
}

/** Build font assets from observed @font-face families + downloaded font files. */
export function buildFontAssets(
  models: readonly EvidenceModel[],
  assets: readonly CloneAsset[]
): BlueprintFontAsset[] {
  const ordered = [...models].sort((a, b) => a.url.localeCompare(b.url));
  const byFamily = new Map<string, { weights: Set<number>; styles: Set<string> }>();
  for (const model of ordered) {
    for (const face of model.fontFaces) {
      const family = face.family.trim();
      if (family.length === 0) {
        continue;
      }
      const entry = byFamily.get(family) ?? {
        weights: new Set<number>(),
        styles: new Set<string>()
      };
      const weight = Number.parseInt(face.weight, 10);
      if (Number.isFinite(weight)) {
        entry.weights.add(weight);
      }
      if (face.style.length > 0) {
        entry.styles.add(face.style);
      }
      byFamily.set(family, entry);
    }
  }

  const fontFiles = assets
    .filter((asset) => asset.assetType === 'font')
    .map((asset) => asset.localPath)
    .sort();

  return [...byFamily.keys()].sort().map((family) => ({
    family,
    weights: [...(byFamily.get(family)?.weights ?? [])].sort((a, b) => a - b),
    styles: [...(byFamily.get(family)?.styles ?? [])].sort(),
    source: fontFiles.length > 0 ? ('custom_file' as const) : ('system' as const),
    ...(fontFiles.length > 0 ? { files: fontFiles } : {})
  }));
}

export interface AssetInput {
  assets: readonly CloneAsset[];
  models: readonly EvidenceModel[];
}

/**
 * Build the `assets` section. Images come from persisted image assets (real
 * sha256 + local path); fonts from observed @font-face declarations; icons from
 * observed icon-font classes or SVG image assets. Deterministic ordering.
 */
export function buildAssets(
  input: AssetInput,
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintAssets {
  const imageAssets = input.assets
    .filter((asset) => asset.assetType === 'image')
    .sort(
      (a, b) => a.sourceUrl.localeCompare(b.sourceUrl) || a.localPath.localeCompare(b.localPath)
    );

  const images: BlueprintImageAsset[] = imageAssets.slice(0, MAX_IMAGES).map((asset, index) => {
    const image: BlueprintImageAsset = {
      id: imageIdFor(asset, index),
      source_url: asset.sourceUrl,
      local_path: asset.localPath,
      mime_type: asset.mimeType,
      sha256: asset.sha256
    };
    collector.addObservation({
      kind: 'asset',
      ref: image.id,
      source: `scan_asset:${asset.sha256}`
    });
    return image;
  });

  const svgAssets = input.assets
    .filter((asset) => asset.assetType === 'image' && asset.mimeType.startsWith('image/svg'))
    .sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));

  const icons: BlueprintIconAsset[] = [];
  const iconIds = new Set<string>();
  for (const asset of svgAssets) {
    const icon: BlueprintIconAsset = {
      id: imageIdFor(asset, icons.length),
      type: iconTypeFor(asset)
    };
    if (iconIds.has(icon.id)) {
      continue;
    }
    iconIds.add(icon.id);
    icons.push(icon);
  }
  for (const icon of observedIconFonts(input.models)) {
    if (iconIds.has(icon.id)) {
      continue;
    }
    iconIds.add(icon.id);
    icons.push(icon);
  }

  return {
    images,
    icons: icons.slice(0, MAX_ICONS),
    fonts: buildFontAssets(input.models, input.assets)
  };
}
