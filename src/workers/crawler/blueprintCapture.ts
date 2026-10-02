/**
 * Worker-side Blueprint evidence capture harness - Artupski ReSite
 * Source of truth: docs/specs/BLUEPRINT-SPEC.md (sections 2.9, 2.12, 2.6) and
 * docs/impl-plan/phase-9-impl-plan.md section 5.1 (decision C12).
 *
 * This module holds the self-contained in-page probe that walks a page's DOM
 * (bounded) and reads ONLY the computed-style subset needed for design tokens,
 * plus the pure normalization/bounding helpers. It contains no policy and no
 * navigation - the worker handler owns those.
 *
 * SECURITY: the probe never reads cookie values, `localStorage`/`sessionStorage`
 * values, input field `value`s, password contents, or `Authorization` headers.
 * Attributes are allowlisted; `script`/`style` bodies are never captured. The
 * result is structure + computed styles ONLY.
 */
import type {
  BlueprintEvidence,
  BlueprintEvidenceFontFace,
  BlueprintEvidenceForm,
  BlueprintEvidenceFormField,
  BlueprintEvidenceHeading,
  BlueprintEvidenceImage,
  BlueprintEvidenceLink,
  BlueprintEvidenceNav,
  BlueprintEvidenceNode,
  BlueprintEvidenceStyles
} from '../../services/infra/workerProtocol.ts';
import {
  MAX_BLUEPRINT_CSS_VARS,
  MAX_BLUEPRINT_FORMS,
  MAX_BLUEPRINT_NODES,
  MAX_BLUEPRINT_TEXT_CHARS
} from '../../services/infra/workerProtocol.ts';

/** The caps applied to one Blueprint evidence capture. */
export interface BlueprintCaptureLimits {
  maxNodes: number;
  maxBytes: number;
  maxTextChars: number;
  maxForms: number;
  maxCssVars: number;
}

/** Default capture caps (the worker clamps caller values to these maxima). */
export const DEFAULT_BLUEPRINT_LIMITS: BlueprintCaptureLimits = {
  maxNodes: MAX_BLUEPRINT_NODES,
  maxBytes: 4 * 1024 * 1024,
  maxTextChars: MAX_BLUEPRINT_TEXT_CHARS,
  maxForms: MAX_BLUEPRINT_FORMS,
  maxCssVars: MAX_BLUEPRINT_CSS_VARS
};

/** Hard cap on DOM depth the probe descends into (defends against deep trees). */
export const MAX_BLUEPRINT_DEPTH = 40;
/** Per-category caps so one category cannot dominate the evidence document. */
export const MAX_BLUEPRINT_LINKS = 500;
export const MAX_BLUEPRINT_IMAGES = 200;
export const MAX_BLUEPRINT_HEADINGS = 200;
export const MAX_BLUEPRINT_NAV_REGIONS = 20;
export const MAX_BLUEPRINT_NAV_ITEMS = 100;
export const MAX_BLUEPRINT_SELECT_OPTIONS = 50;
export const MAX_BLUEPRINT_FONT_FACES = 50;

/**
 * Build the self-contained in-page probe expression. Every cap is interpolated
 * as a literal so the probe has no closures and is safe to `page.evaluate`.
 */
export function buildBlueprintProbe(limits: BlueprintCaptureLimits): string {
  return `(() => {
  var MAX_NODES = ${limits.maxNodes};
  var MAX_TEXT = ${limits.maxTextChars};
  var MAX_FORMS = ${limits.maxForms};
  var MAX_CSS_VARS = ${limits.maxCssVars};
  var MAX_DEPTH = ${MAX_BLUEPRINT_DEPTH};
  var MAX_LINKS = ${MAX_BLUEPRINT_LINKS};
  var MAX_IMAGES = ${MAX_BLUEPRINT_IMAGES};
  var MAX_HEADINGS = ${MAX_BLUEPRINT_HEADINGS};
  var MAX_NAV = ${MAX_BLUEPRINT_NAV_REGIONS};
  var MAX_NAV_ITEMS = ${MAX_BLUEPRINT_NAV_ITEMS};
  var MAX_OPTIONS = ${MAX_BLUEPRINT_SELECT_OPTIONS};
  var MAX_FACES = ${MAX_BLUEPRINT_FONT_FACES};

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, LINK: 1, META: 1, TITLE: 1 };
  var ATTR_ALLOW = ['id','href','src','alt','title','type','name','placeholder','role','for','action','method','rel','target','width','height','lang','dir','aria-label','aria-labelledby','aria-hidden','aria-expanded','aria-current','aria-haspopup'];

  function trim(value) {
    var s = (value === null || value === undefined) ? '' : String(value);
    s = s.replace(/\\s+/g, ' ').trim();
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
  }

  function ownText(el) {
    var out = '';
    var children = el.childNodes || [];
    for (var i = 0; i < children.length; i += 1) {
      if (children[i].nodeType === 3) { out += (children[i].nodeValue || '') + ' '; }
    }
    return trim(out);
  }

  function semanticOf(tag, role) {
    var out = [];
    if (role) { out.push(role); }
    var landmark = { header: 'header', footer: 'footer', nav: 'nav', main: 'main', aside: 'sidebar', section: 'section', article: 'article', form: 'form' };
    if (landmark[tag]) { out.push(landmark[tag]); }
    if (/^h[1-6]$/.test(tag)) { out.push('heading'); }
    if (tag === 'a') { out.push('link'); }
    if (tag === 'button' || role === 'button') { out.push('button'); }
    if (tag === 'img') { out.push('image'); }
    if (tag === 'ul' || tag === 'ol') { out.push('list'); }
    if (tag === 'li') { out.push('list-item'); }
    if (tag === 'table') { out.push('table'); }
    return out;
  }

  function collectAttrs(el) {
    var attrs = {};
    for (var i = 0; i < ATTR_ALLOW.length; i += 1) {
      var name = ATTR_ALLOW[i];
      if (el.hasAttribute && el.hasAttribute(name)) {
        var value = el.getAttribute(name);
        if (value !== null && value !== '') {
          attrs[name] = value.length > 256 ? value.slice(0, 256) : value;
        }
      }
    }
    return attrs;
  }

  function stylesOf(el) {
    var cs = window.getComputedStyle(el);
    return {
      display: cs.display || '',
      position: cs.position || '',
      flexDirection: cs.flexDirection || '',
      gridTemplateColumns: cs.gridTemplateColumns || '',
      fontSize: cs.fontSize || '',
      fontWeight: cs.fontWeight || '',
      lineHeight: cs.lineHeight || '',
      color: cs.color || '',
      backgroundColor: cs.backgroundColor || '',
      borderColor: cs.borderTopColor || '',
      borderRadius: cs.borderTopLeftRadius || '',
      boxShadow: cs.boxShadow || '',
      margin: (cs.marginTop + ' ' + cs.marginRight + ' ' + cs.marginBottom + ' ' + cs.marginLeft).trim(),
      padding: (cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft).trim(),
      gap: cs.gap || (cs.rowGap + ' ' + cs.columnGap).trim(),
      fontFamily: cs.fontFamily || ''
    };
  }

  function visibleOf(cs, rect) {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') { return false; }
    if (parseFloat(cs.opacity || '1') === 0) { return false; }
    return rect.width > 0 && rect.height > 0;
  }

  var nodes = [];
  var byId = {};
  var elIds = new WeakMap();
  var truncated = false;
  var nodeCount = 0;
  var idCounter = 0;

  var root = document.documentElement;
  var queue = root ? [{ el: root, parentId: null, depth: 0 }] : [];
  var head = 0;
  while (head < queue.length) {
    var item = queue[head];
    head += 1;
    var el = item.el;
    var tagName = el.tagName ? el.tagName.toUpperCase() : '';
    if (SKIP[tagName]) { continue; }
    nodeCount += 1;
    if (nodes.length >= MAX_NODES) { truncated = true; break; }

    var id = 'n' + idCounter;
    idCounter += 1;
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    var cs = window.getComputedStyle(el);
    var role = el.getAttribute ? (el.getAttribute('role') || '') : '';
    var classes = [];
    if (el.classList) {
      for (var ci = 0; ci < el.classList.length && ci < 40; ci += 1) { classes.push(el.classList[ci]); }
    }
    var node = {
      id: id,
      parentId: item.parentId,
      tag: tagName.toLowerCase(),
      role: role,
      semantic: semanticOf(tagName.toLowerCase(), role),
      text: ownText(el),
      attrs: collectAttrs(el),
      classes: classes,
      childIds: [],
      visible: visibleOf(cs, rect),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      styles: stylesOf(el)
    };
    nodes.push(node);
    byId[id] = node;
    elIds.set(el, id);
    if (item.parentId !== null && byId[item.parentId]) { byId[item.parentId].childIds.push(id); }

    var kids = el.children || [];
    if (item.depth < MAX_DEPTH) {
      for (var k = 0; k < kids.length; k += 1) { queue.push({ el: kids[k], parentId: id, depth: item.depth + 1 }); }
    } else if (kids.length > 0) {
      truncated = true;
    }
  }

  // CSS custom properties declared in applied stylesheets + inline :root style.
  var varNames = {};
  var varCount = 0;
  try {
    for (var s = 0; s < document.styleSheets.length; s += 1) {
      var sheet = document.styleSheets[s];
      var rules = null;
      try { rules = sheet.cssRules; } catch (e) { rules = null; }
      if (!rules) { continue; }
      for (var r = 0; r < rules.length; r += 1) {
        var rule = rules[r];
        var style = rule && rule.style;
        if (!style) { continue; }
        for (var p = 0; p < style.length; p += 1) {
          var pname = style[p];
          if (pname && pname.indexOf('--') === 0 && !varNames[pname] && varCount < MAX_CSS_VARS) {
            varNames[pname] = true;
            varCount += 1;
          }
        }
      }
    }
  } catch (e) { /* cross-origin sheets are skipped */ }
  try {
    var inline = document.documentElement.style;
    for (var q = 0; q < inline.length; q += 1) {
      var iname = inline[q];
      if (iname && iname.indexOf('--') === 0 && !varNames[iname] && varCount < MAX_CSS_VARS) {
        varNames[iname] = true;
        varCount += 1;
      }
    }
  } catch (e) { /* ignore */ }
  var cssVariables = {};
  var rootCs = window.getComputedStyle(document.documentElement);
  var names = Object.keys(varNames).sort();
  for (var vi = 0; vi < names.length; vi += 1) {
    var name = names[vi];
    var value = rootCs.getPropertyValue(name);
    if (value) { cssVariables[name] = value.trim(); }
  }

  // @font-face families/weights/styles (never font bytes).
  var fontFaces = [];
  try {
    if (document.fonts && document.fonts.forEach) {
      var seenFace = {};
      document.fonts.forEach(function (face) {
        var key = (face.family || '') + '|' + (face.weight || '') + '|' + (face.style || '');
        if (!seenFace[key] && fontFaces.length < MAX_FACES) {
          seenFace[key] = true;
          fontFaces.push({
            family: String(face.family || '').replace(/^"|"$/g, ''),
            weight: String(face.weight || ''),
            style: String(face.style || '')
          });
        }
      });
    }
  } catch (e) { /* ignore */ }

  // Forms: structure + validation attributes ONLY. Field values are never read.
  var forms = [];
  try {
    var formEls = document.querySelectorAll('form');
    for (var fi = 0; fi < formEls.length && fi < MAX_FORMS; fi += 1) {
      var form = formEls[fi];
      var fields = [];
      var controls = form.querySelectorAll('input, select, textarea');
      for (var ci2 = 0; ci2 < controls.length && ci2 < 100; ci2 += 1) {
        var ctrl = controls[ci2];
        var ctag = ctrl.tagName.toLowerCase();
        var ctype = (ctrl.getAttribute('type') || (ctag === 'select' ? 'select' : (ctag === 'textarea' ? 'textarea' : 'text'))).toLowerCase();
        if (ctype === 'submit' || ctype === 'button' || ctype === 'reset' || ctype === 'image') { continue; }
        var fieldName = ctrl.getAttribute('name') || ctrl.getAttribute('id') || '';
        var label = '';
        if (ctrl.id) {
          try {
            var labelEl = document.querySelector('label[for="' + CSS.escape(ctrl.id) + '"]');
            if (labelEl) { label = trim(labelEl.textContent); }
          } catch (e2) { /* ignore */ }
        }
        if (!label && ctrl.closest) {
          var wrap = ctrl.closest('label');
          if (wrap) { label = trim(wrap.textContent); }
        }
        if (!label) { label = trim(ctrl.getAttribute('aria-label') || ''); }
        var options = [];
        if (ctag === 'select') {
          var optEls = ctrl.querySelectorAll('option');
          for (var oi = 0; oi < optEls.length && oi < MAX_OPTIONS; oi += 1) {
            options.push({ label: trim(optEls[oi].textContent), value: String(optEls[oi].getAttribute('value') || '') });
          }
        }
        var validations = {};
        var vattrs = ['pattern', 'min', 'max', 'minlength', 'maxlength', 'step'];
        for (var vx = 0; vx < vattrs.length; vx += 1) {
          var vv = ctrl.getAttribute(vattrs[vx]);
          if (vv !== null && vv !== '') { validations[vattrs[vx]] = String(vv).slice(0, 128); }
        }
        fields.push({
          name: fieldName,
          label: label,
          type: ctype,
          required: ctrl.hasAttribute('required') || ctrl.getAttribute('aria-required') === 'true',
          placeholder: ctrl.getAttribute('placeholder') || null,
          options: options,
          validations: validations
        });
      }
      var submitLabel = '';
      var submitEl = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
      if (submitEl) { submitLabel = trim(submitEl.textContent || submitEl.getAttribute('value') || ''); }
      forms.push({
        id: form.getAttribute('id') || ('form' + fi),
        name: form.getAttribute('name') || '',
        method: (form.getAttribute('method') || 'GET').toUpperCase(),
        action: form.getAttribute('action') || '',
        fields: fields,
        submitButtonLabel: submitLabel
      });
    }
  } catch (e) { /* ignore */ }

  // Navigation regions (header/footer/nav) with their anchors.
  var nav = [];
  try {
    var regions = document.querySelectorAll('header, footer, nav');
    for (var ni = 0; ni < regions.length && ni < MAX_NAV; ni += 1) {
      var region = regions[ni];
      var items = [];
      var anchors = region.querySelectorAll('a[href]');
      for (var ai = 0; ai < anchors.length && ai < MAX_NAV_ITEMS; ai += 1) {
        var anchor = anchors[ai];
        var depth = 0;
        var par = anchor.parentElement;
        while (par && par !== region && depth < 6) {
          if (par.tagName === 'UL' || par.tagName === 'OL' || par.tagName === 'LI') { depth += 1; }
          par = par.parentElement;
        }
        items.push({ href: anchor.getAttribute('href') || '', text: trim(anchor.textContent), target: anchor.getAttribute('target') || null, depth: depth });
      }
      if (items.length > 0 || region.tagName === 'NAV') {
        nav.push({ region: region.tagName.toLowerCase(), label: trim(region.getAttribute('aria-label') || ''), items: items });
      }
    }
  } catch (e) { /* ignore */ }

  // Headings.
  var headings = [];
  try {
    var headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (var hi = 0; hi < headingEls.length && hi < MAX_HEADINGS; hi += 1) {
      var h = headingEls[hi];
      headings.push({ level: parseInt(h.tagName.substring(1), 10) || 1, text: trim(h.textContent), nodeId: elIds.get(h) || '' });
    }
  } catch (e) { /* ignore */ }

  // Links.
  var links = [];
  try {
    var linkEls = document.querySelectorAll('a[href]');
    for (var li = 0; li < linkEls.length && li < MAX_LINKS; li += 1) {
      var la = linkEls[li];
      links.push({ href: la.getAttribute('href') || '', text: trim(la.textContent), target: la.getAttribute('target') || null, nodeId: elIds.get(la) || '' });
    }
  } catch (e) { /* ignore */ }

  // Images (URL + alt + intrinsic size only; never bytes).
  var images = [];
  try {
    var imgEls = document.querySelectorAll('img');
    for (var ii = 0; ii < imgEls.length && ii < MAX_IMAGES; ii += 1) {
      var img = imgEls[ii];
      images.push({
        src: img.getAttribute('src') || '',
        alt: trim(img.getAttribute('alt') || ''),
        width: img.naturalWidth || null,
        height: img.naturalHeight || null,
        nodeId: elIds.get(img) || ''
      });
    }
  } catch (e) { /* ignore */ }

  return { nodes: nodes, cssVariables: cssVariables, fontFaces: fontFaces, forms: forms, nav: nav, headings: headings, links: links, images: images, truncated: truncated, nodeCount: nodeCount };
})()`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function coerceStringRecord(
  value: unknown,
  maxEntries: number,
  maxValueLength: number
): Record<string, string> {
  const result: Record<string, string> = {};
  const source = asRecord(value);
  let count = 0;
  for (const key of Object.keys(source).sort()) {
    if (count >= maxEntries) {
      break;
    }
    const raw = source[key];
    if (typeof raw === 'string' && raw.length > 0) {
      result[key] = raw.length > maxValueLength ? raw.slice(0, maxValueLength) : raw;
      count += 1;
    }
  }
  return result;
}

function coerceStringArray(value: unknown, max: number): string[] {
  const result: string[] = [];
  for (const entry of asArray(value)) {
    if (result.length >= max) {
      break;
    }
    if (typeof entry === 'string' && entry.length > 0) {
      result.push(entry);
    }
  }
  return result;
}

function coerceStyles(value: unknown): BlueprintEvidenceStyles {
  const record = asRecord(value);
  const field = (key: string): string => {
    const raw = record[key];
    return typeof raw === 'string' ? raw.slice(0, 256) : '';
  };
  return {
    display: field('display'),
    position: field('position'),
    flexDirection: field('flexDirection'),
    gridTemplateColumns: field('gridTemplateColumns'),
    fontSize: field('fontSize'),
    fontWeight: field('fontWeight'),
    lineHeight: field('lineHeight'),
    color: field('color'),
    backgroundColor: field('backgroundColor'),
    borderColor: field('borderColor'),
    borderRadius: field('borderRadius'),
    boxShadow: field('boxShadow'),
    margin: field('margin'),
    padding: field('padding'),
    gap: field('gap'),
    fontFamily: field('fontFamily')
  };
}

function coerceNode(value: unknown, maxTextChars: number): BlueprintEvidenceNode {
  const record = asRecord(value);
  const bounds = asRecord(record.bounds);
  const bound = (key: string): number => {
    const raw = bounds[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 0;
  };
  return {
    id: asString(record.id),
    parentId: record.parentId === null ? null : asStringOrNull(record.parentId),
    tag: asString(record.tag).slice(0, 64),
    role: asString(record.role).slice(0, 64),
    semantic: coerceStringArray(record.semantic, 16),
    text: asString(record.text).slice(0, maxTextChars),
    attrs: coerceStringRecord(record.attrs, 32, 512),
    classes: coerceStringArray(record.classes, 40),
    childIds: coerceStringArray(record.childIds, 1000),
    visible: record.visible === true,
    bounds: { x: bound('x'), y: bound('y'), width: bound('width'), height: bound('height') },
    styles: coerceStyles(record.styles)
  };
}

function coerceLink(value: unknown, maxTextChars: number): BlueprintEvidenceLink {
  const record = asRecord(value);
  return {
    href: asString(record.href).slice(0, 2048),
    text: asString(record.text).slice(0, maxTextChars),
    target: asStringOrNull(record.target),
    nodeId: asString(record.nodeId)
  };
}

function coerceHeading(value: unknown, maxTextChars: number): BlueprintEvidenceHeading {
  const record = asRecord(value);
  const level =
    typeof record.level === 'number' && Number.isFinite(record.level)
      ? Math.trunc(record.level)
      : 1;
  return {
    level: level >= 1 && level <= 6 ? level : 1,
    text: asString(record.text).slice(0, maxTextChars),
    nodeId: asString(record.nodeId)
  };
}

function coerceImage(value: unknown, maxTextChars: number): BlueprintEvidenceImage {
  const record = asRecord(value);
  return {
    src: asString(record.src).slice(0, 2048),
    alt: asString(record.alt).slice(0, maxTextChars),
    width: asNumberOrNull(record.width),
    height: asNumberOrNull(record.height),
    nodeId: asString(record.nodeId)
  };
}

function coerceNav(value: unknown, maxTextChars: number): BlueprintEvidenceNav {
  const record = asRecord(value);
  const items: BlueprintEvidenceNav['items'] = [];
  for (const entry of asArray(record.items)) {
    if (items.length >= MAX_BLUEPRINT_NAV_ITEMS) {
      break;
    }
    const item = asRecord(entry);
    const depth =
      typeof item.depth === 'number' && Number.isFinite(item.depth) ? Math.trunc(item.depth) : 0;
    items.push({
      href: asString(item.href).slice(0, 2048),
      text: asString(item.text).slice(0, maxTextChars),
      target: asStringOrNull(item.target),
      depth: depth < 0 ? 0 : Math.min(depth, 10)
    });
  }
  return {
    region: asString(record.region).slice(0, 32),
    label: asString(record.label).slice(0, maxTextChars),
    items
  };
}

function coerceField(value: unknown, maxTextChars: number): BlueprintEvidenceFormField {
  const record = asRecord(value);
  const options: Array<{ label: string; value: string }> = [];
  for (const entry of asArray(record.options)) {
    if (options.length >= MAX_BLUEPRINT_SELECT_OPTIONS) {
      break;
    }
    const option = asRecord(entry);
    options.push({
      label: asString(option.label).slice(0, maxTextChars),
      value: asString(option.value).slice(0, 512)
    });
  }
  return {
    name: asString(record.name).slice(0, 256),
    label: asString(record.label).slice(0, maxTextChars),
    type: asString(record.type).slice(0, 64),
    required: record.required === true,
    placeholder: asStringOrNull(record.placeholder),
    options,
    validations: coerceStringRecord(record.validations, 16, 128)
  };
}

function coerceForm(value: unknown, maxTextChars: number): BlueprintEvidenceForm {
  const record = asRecord(value);
  const fields: BlueprintEvidenceFormField[] = [];
  for (const entry of asArray(record.fields)) {
    if (fields.length >= 100) {
      break;
    }
    fields.push(coerceField(entry, maxTextChars));
  }
  return {
    id: asString(record.id).slice(0, 256),
    name: asString(record.name).slice(0, 256),
    method: asString(record.method).slice(0, 16).toUpperCase() || 'GET',
    action: asString(record.action).slice(0, 2048),
    fields,
    submitButtonLabel: asString(record.submitButtonLabel).slice(0, maxTextChars)
  };
}

function coerceFontFace(value: unknown): BlueprintEvidenceFontFace {
  const record = asRecord(value);
  return {
    family: asString(record.family).slice(0, 256),
    weight: asString(record.weight).slice(0, 64),
    style: asString(record.style).slice(0, 64)
  };
}

/** Context supplied by the worker handler (from navigation, not the DOM). */
export interface BlueprintEvidenceContext {
  url: string;
  status: number | null;
  capturedAt: string;
  limits: BlueprintCaptureLimits;
}

/**
 * Normalize the raw probe output into a bounded, defensively-coerced evidence
 * document. Page content is untrusted, so every field is coerced and capped; no
 * unknown keys survive and no secret is ever synthesized.
 */
export function normalizeBlueprintEvidence(
  raw: unknown,
  context: BlueprintEvidenceContext
): BlueprintEvidence {
  const record = asRecord(raw);
  const maxText = context.limits.maxTextChars;

  const nodes: BlueprintEvidenceNode[] = [];
  for (const entry of asArray(record.nodes)) {
    if (nodes.length >= context.limits.maxNodes) {
      break;
    }
    nodes.push(coerceNode(entry, maxText));
  }

  const links: BlueprintEvidenceLink[] = [];
  for (const entry of asArray(record.links)) {
    if (links.length >= MAX_BLUEPRINT_LINKS) {
      break;
    }
    links.push(coerceLink(entry, maxText));
  }

  const images: BlueprintEvidenceImage[] = [];
  for (const entry of asArray(record.images)) {
    if (images.length >= MAX_BLUEPRINT_IMAGES) {
      break;
    }
    images.push(coerceImage(entry, maxText));
  }

  const headings: BlueprintEvidenceHeading[] = [];
  for (const entry of asArray(record.headings)) {
    if (headings.length >= MAX_BLUEPRINT_HEADINGS) {
      break;
    }
    headings.push(coerceHeading(entry, maxText));
  }

  const nav: BlueprintEvidenceNav[] = [];
  for (const entry of asArray(record.nav)) {
    if (nav.length >= MAX_BLUEPRINT_NAV_REGIONS) {
      break;
    }
    nav.push(coerceNav(entry, maxText));
  }

  const forms: BlueprintEvidenceForm[] = [];
  for (const entry of asArray(record.forms)) {
    if (forms.length >= context.limits.maxForms) {
      break;
    }
    forms.push(coerceForm(entry, maxText));
  }

  const fontFaces: BlueprintEvidenceFontFace[] = [];
  for (const entry of asArray(record.fontFaces)) {
    if (fontFaces.length >= MAX_BLUEPRINT_FONT_FACES) {
      break;
    }
    fontFaces.push(coerceFontFace(entry));
  }

  const nodeCount =
    typeof record.nodeCount === 'number' && Number.isFinite(record.nodeCount)
      ? Math.max(0, Math.trunc(record.nodeCount))
      : nodes.length;

  const evidence: BlueprintEvidence = {
    url: context.url,
    status: context.status,
    capturedAt: context.capturedAt,
    nodes,
    cssVariables: coerceStringRecord(record.cssVariables, context.limits.maxCssVars, 512),
    fontFaces,
    forms,
    nav,
    headings,
    links,
    images,
    truncated: record.truncated === true,
    nodeCount,
    byteLength: 0,
    limits: {
      maxNodes: context.limits.maxNodes,
      maxBytes: context.limits.maxBytes,
      maxTextChars: context.limits.maxTextChars,
      maxForms: context.limits.maxForms,
      maxCssVars: context.limits.maxCssVars
    }
  };

  return boundBlueprintEvidence(evidence, context.limits.maxBytes);
}

/** UTF-8 byte length without a Node-only dependency (works in jsdom too). */
function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferCtor = (globalThis as any).Buffer;
  return bufferCtor.byteLength(text, 'utf8');
}

function byteLengthOf(evidence: BlueprintEvidence): number {
  return utf8ByteLength(JSON.stringify(evidence));
}

/** Largest collection that can still be trimmed, or null when all are empty. */
function largestCollection(evidence: BlueprintEvidence): keyof BlueprintEvidence | null {
  let best: keyof BlueprintEvidence | null = null;
  let bestLength = 0;
  const collections: Array<keyof BlueprintEvidence> = [
    'nodes',
    'links',
    'images',
    'headings',
    'nav',
    'forms',
    'fontFaces'
  ];
  for (const key of collections) {
    const value = evidence[key];
    if (Array.isArray(value) && value.length > bestLength) {
      best = key;
      bestLength = value.length;
    }
  }
  return best;
}

/**
 * Trim the evidence document until its serialized size fits `maxBytes`, dropping
 * from the largest collection first and flagging `truncated`. Dangling
 * `childIds` references are pruned so the tree stays internally consistent.
 */
export function boundBlueprintEvidence(
  evidence: BlueprintEvidence,
  maxBytes: number
): BlueprintEvidence {
  let current: BlueprintEvidence = { ...evidence };
  let bytes = byteLengthOf(current);
  if (bytes <= maxBytes) {
    return { ...current, byteLength: bytes };
  }
  current.truncated = true;
  let guard = 0;
  while (bytes > maxBytes && guard < 10_000) {
    guard += 1;
    const key = largestCollection(current);
    if (!key) {
      break;
    }
    const value = current[key];
    if (!Array.isArray(value) || value.length === 0) {
      break;
    }
    const drop = Math.max(1, Math.ceil(value.length * 0.2));
    const trimmed = value.slice(0, Math.max(0, value.length - drop));
    current = { ...current, [key]: trimmed } as BlueprintEvidence;
    bytes = byteLengthOf(current);
  }

  // Prune childIds that reference a node no longer present.
  const present = new Set(current.nodes.map((node) => node.id));
  current = {
    ...current,
    nodes: current.nodes.map((node) => ({
      ...node,
      childIds: node.childIds.filter((id) => present.has(id))
    }))
  };
  bytes = byteLengthOf(current);
  return { ...current, byteLength: bytes };
}
