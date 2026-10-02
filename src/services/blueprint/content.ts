/**
 * Content strings + blocks extraction - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.5 and
 * docs/specs/BLUEPRINT-SPEC.md section 2.7.
 *
 * Builds the `content.strings` map (deterministic `page.section.field` keys from
 * observed headings + labels) and `content.blocks` from long-form observed text.
 * Only observed text is used; nothing is generated. Markdown is chosen only when
 * the source is clearly markdown-like, otherwise `html`.
 */
import type { BlueprintContent, BlueprintContentBlock } from '../../types/blueprint';
import type { ScanPage } from '../../types/models';
import type { EvidenceModel } from './evidence';
import { ProvenanceCollector } from './evidence';
import { collapseWhitespace, slugify } from './util';

/** Minimum characters for a heading/paragraph to be captured as a block. */
const MIN_BLOCK_LENGTH = 120;
const MAX_BLOCK_LENGTH = 20_000;

export interface ContentPageInput {
  page: ScanPage;
  model: EvidenceModel;
}

function isMarkdownLike(text: string): boolean {
  const heading = /(?:^|\n)#{1,6}\s/.test(text);
  const bullet = /(?:^|\n)[-*]\s/.test(text);
  const link = /\[[^\]]+\]\([^)]+\)/.test(text);
  const quote = /(?:^|\n)>\s/.test(text);
  return heading || bullet || link || quote;
}

/** Derive a readable section name from the nearest ancestor's classes/tag. */
function sectionNameFor(model: EvidenceModel, nodeId: string): string {
  let current = model.nodeById.get(nodeId);
  let guard = 0;
  while (current && guard < 8) {
    guard += 1;
    const keyword = current.classes.find((token) =>
      /hero|header|footer|nav|card|contact|feature|pricing|cta|testimonial|section/i.test(token)
    );
    if (keyword) {
      return slugify(keyword) || 'section';
    }
    current = current.parentId ? model.nodeById.get(current.parentId) : undefined;
  }
  return 'main';
}

/**
 * Build content strings + blocks across every page's evidence. Deterministic:
 * pages are processed in path order, headings in evidence order, and keys are
 * de-duplicated with a stable numeric suffix when they collide.
 */
export function buildContent(
  inputs: readonly ContentPageInput[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintContent {
  const ordered = [...inputs].sort(
    (a, b) => a.page.path.localeCompare(b.page.path) || a.page.id.localeCompare(b.page.id)
  );

  const strings: Record<string, string> = {};
  const blocks: BlueprintContentBlock[] = [];
  const usedKeys = new Set<string>();

  const putString = (pageKey: string, fieldKey: string, value: string): void => {
    const text = collapseWhitespace(value);
    if (text.length === 0) {
      return;
    }
    let key = `${pageKey}.${fieldKey}`;
    let suffix = 1;
    while (usedKeys.has(key)) {
      suffix += 1;
      key = `${pageKey}.${fieldKey}_${suffix}`;
    }
    usedKeys.add(key);
    strings[key] = text;
  };

  for (const { page, model } of ordered) {
    const pageKey = page.path === '/' ? 'home' : slugify(page.path) || 'page';

    // Headings → title/subtitle strings.
    model.headings.forEach((heading, index) => {
      const text = collapseWhitespace(heading.text);
      if (text.length === 0) {
        return;
      }
      const section = heading.nodeId ? sectionNameFor(model, heading.nodeId) : 'main';
      const field =
        heading.level === 1 && index === 0 ? 'title' : `heading_${heading.level}_${index + 1}`;
      putString(pageKey, `${section}.${field}`, text);
    });

    // Long-form observed text → blocks.
    model.visibleNodes.forEach((node) => {
      if (!/^(p|pre|code|blockquote)$/.test(node.tag)) {
        return;
      }
      const text = collapseWhitespace(node.text);
      if (text.length < MIN_BLOCK_LENGTH) {
        return;
      }
      const content = text.slice(0, MAX_BLOCK_LENGTH);
      const section = sectionNameFor(model, node.id);
      blocks.push({
        id: `block_${pageKey}_${section}_${node.id}`,
        type: isMarkdownLike(content) ? 'markdown' : 'html',
        content
      });
      collector.addObservation({
        kind: 'content_block',
        ref: `block_${pageKey}_${section}_${node.id}`,
        source: `dom_node:${node.id}`
      });
    });
  }

  return { strings, blocks };
}
