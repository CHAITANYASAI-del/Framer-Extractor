// Site model: loads the export's CMS, applies edits, and builds the exact set
// of file changes needed so the static site shows them.
//
// Why each step is needed (all verified against Framer's runtime):
//  1. Re-encode the collection's .framercms data.
//  2. Strip the collection's `indexes:[…]` in its JS module. Indexes point at
//     byte offsets in the old data; without them Framer scans the data instead.
//  3. Remove `__framer__handoverData` from pages. Framer embeds query results
//     in each page for hydration; without it the page reads the live data.
//  4. Patch pre-rendered text/title/meta on item pages (SEO + no flash).
//  5. New items: clone a sibling item page, point it at the new item, and let
//     Framer render it client-side. Deleted items: remove their page.

import { decodeChunk, encodeChunk } from './codec.js';
import { richTextToHtml, richTextToPlain } from './richtext.js';

export const ROOT = new URL('../', location.href).href;           // site root (the CMS lives in /cms/)
export const pageFile = p => (p === '' ? 'index.html' : p === '404' ? '404.html' : `${p}/index.html`);

const SYSTEM_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'previousItemId', 'nextItemId']);

const textCache = new Map();
export function clearCache() { textCache.clear(); }

// Files just published to GitHub/Vercel that the live site may not serve yet
// (deploys and CDN caches take a minute or more). Reads prefer them, so the
// preview and the next publish build on what was published — never on the
// older live copy (which would quietly undo the last publish).
let published = new Map();
export function setPublishedOverlay(files) { published = new Map(files || []); textCache.clear(); }
export const publishedOverlay = () => published;
const fromOverlay = path => {
  if (!published.has(path)) return undefined;
  const v = published.get(path);
  if (v === null) throw new Error(`${path}: HTTP 404`);
  return v;
};

export async function readText(path, { cache = false } = {}) {
  const o = fromOverlay(path);
  if (o !== undefined) return typeof o === 'string' ? o : new TextDecoder().decode(o);
  if (cache && textCache.has(path)) return textCache.get(path);
  const r = await fetch(ROOT + path, { cache: 'no-store', headers: { 'x-fx-fresh': '1' } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const t = await r.text();
  if (cache) textCache.set(path, t);
  return t;
}
export async function readBytes(path) {
  const o = fromOverlay(path);
  if (o !== undefined) return typeof o === 'string' ? new TextEncoder().encode(o) : o;
  const r = await fetch(ROOT + path, { cache: 'no-store', headers: { 'x-fx-fresh': '1' } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ── Loading ──────────────────────────────────────────────────────────────────
export async function loadSite() {
  const manifest = JSON.parse(await readText('cms/fx-site.json'));
  const collections = [];
  for (const c of manifest.collections) {
    const defaults = c.chunks.filter(ch => ch.locale === 'default');
    const use = defaults.length ? defaults : c.chunks;
    let items = [];
    for (const ch of use) {
      try { items = items.concat(decodeChunk(await readBytes(ch.file))); }
      catch (e) { console.warn('[admin] could not read', ch.file, e); }
    }
    collections.push({
      ...c,
      items: items.map(data => ({
        key: data.id?.v || Math.random().toString(36).slice(2),
        data,
        orig: structuredClone(data),
        status: 'clean',
        page: c.itemPages?.[data.id?.v] || null,
      })),
    });
  }
  // Main content first: collections with their own pages, then by size
  collections.sort((a, b) =>
    (b.pagePrefix ? 1 : 0) - (a.pagePrefix ? 1 : 0) || b.items.length - a.items.length);
  return { manifest, collections };
}

// ── Field helpers ────────────────────────────────────────────────────────────
export function fieldsOf(col) {
  // Editable fields in schema order; system fields hidden
  return col.fields.filter(f => !SYSTEM_KEYS.has(f.id));
}
export function itemTitle(col, item) {
  const d = item.data;
  const tf = col.titleFieldId && d[col.titleFieldId];
  if (tf && tf.v) return String(tf.v);
  const sf = col.slugFieldId && d[col.slugFieldId];
  if (sf && sf.v) return String(sf.v);
  for (const f of col.fields) { const v = d[f.id]; if (v && v.t === 'string' && v.v && !SYSTEM_KEYS.has(f.id)) return v.v; }
  return 'Untitled';
}
export function itemSlug(col, item) {
  const v = col.slugFieldId && item.data[col.slugFieldId];
  return v && v.v ? String(v.v) : '';
}
export function itemImageSrc(col, item) {
  for (const f of col.fields) {
    const v = item.data[f.id];
    if (v && v.t === 'image' && v.v) return typeof v.v === 'string' ? v.v : v.v.src;
  }
  return null;
}
export function itemImage(col, item, imageMap) {
  for (const f of col.fields) {
    const v = item.data[f.id];
    if (v && v.t === 'image' && v.v) {
      const src = typeof v.v === 'string' ? v.v : v.v.src;
      if (src) return resolveImage(src, imageMap);
    }
  }
  return null;
}
export function resolveImage(src, imageMap) {
  if (!src) return null;
  const base = String(src).split('?')[0];
  if (imageMap && imageMap[base]) return ROOT + imageMap[base];
  if (/^https?:/.test(src)) return src;
  return ROOT + String(src).replace(/^\.?\//, '');
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}
export function uniqueSlug(col, base, exceptKey) {
  const taken = new Set(col.items.filter(i => i.key !== exceptKey && i.status !== 'deleted').map(i => itemSlug(col, i)));
  let s = base || 'item', n = 2;
  while (taken.has(s)) s = `${base}-${n++}`;
  return s;
}
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function newId() {
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(9));
  for (const b of r) s += ID_CHARS[b % ID_CHARS.length];
  return s;
}

export function defaultValue(field) {
  switch (field.type) {
    case 'String': return { t: 'string', v: '' };
    case 'RichText': return { t: 'richtext', v: '[1]' };
    case 'Date': return { t: 'date', v: new Date().toISOString() };
    case 'Boolean': return { t: 'boolean', v: false };
    case 'Number': return { t: 'number', v: 0 };
    case 'Color': return { t: 'color', v: '#000000' };
    case 'MultiCollectionReference': return { t: 'array', v: [] };
    default: return { t: 'null', v: null };
  }
}

// ── Item operations (pure: return new collection objects) ────────────────────
export function createItem(col, title) {
  const now = new Date().toISOString();
  const template = col.items.find(i => i.status !== 'deleted');
  const data = {};
  const keys = template ? Object.keys(template.data) : col.fields.map(f => f.id);
  for (const k of new Set([...keys, ...col.fields.map(f => f.id)])) {
    const f = col.fields.find(x => x.id === k);
    if (k === 'id') data.id = { t: 'string', v: newId() };
    else if (k === 'createdAt' || k === 'updatedAt') data[k] = { t: 'date', v: now };
    else if (k === 'previousItemId' || k === 'nextItemId') data[k] = { t: 'null', v: null };
    else data[k] = f ? defaultValue(f) : { t: 'null', v: null };
  }
  if (!data.id) data.id = { t: 'string', v: newId() };
  if (col.titleFieldId) data[col.titleFieldId] = { t: 'string', v: title || 'New item' };
  if (col.slugFieldId) data[col.slugFieldId] = { t: 'string', v: uniqueSlug(col, slugify(title || 'new-item')) };
  return { key: data.id.v, data, orig: null, status: 'new', page: null };
}

export function duplicateItem(col, item) {
  const data = structuredClone(item.data);
  data.id = { t: 'string', v: newId() };
  const now = new Date().toISOString();
  if (data.createdAt) data.createdAt = { t: 'date', v: now };
  if (data.updatedAt) data.updatedAt = { t: 'date', v: now };
  if (col.titleFieldId && data[col.titleFieldId]) data[col.titleFieldId] = { t: 'string', v: `${data[col.titleFieldId].v} (copy)` };
  if (col.slugFieldId) data[col.slugFieldId] = { t: 'string', v: uniqueSlug(col, `${itemSlug(col, item)}-copy`) };
  return { key: data.id.v, data, orig: null, status: 'new', page: null };
}

export function isDirty(col) { return col.items.some(i => i.status !== 'clean'); }

// ── Page transforms ──────────────────────────────────────────────────────────
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => escHtml(s).replace(/"/g, '&quot;');
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function stripHandover(html) {
  return html.replace(/<script type="framer\/handover" id="__framer__handoverData">[\s\S]*?<\/script>/, '');
}
function stripIndexes(js) {
  let out = '', i = 0;
  for (;;) {
    const at = js.indexOf('indexes:[', i);
    if (at === -1) { out += js.slice(i); break; }
    out += js.slice(i, at) + 'indexes:[]';
    let d = 0, j = at + 'indexes:'.length;
    for (; j < js.length; j++) {
      const c = js[j];
      if (c === '[') d++;
      else if (c === ']') { d--; if (d === 0) break; }
    }
    i = j + 1;
  }
  return out;
}
function setPagePath(html, path) {
  // The root-detection script injected at export: var P="work/noir"
  return html.replace(/var P=("(?:[^"\\]|\\.)*")/, () => `var P=${JSON.stringify(path)}`);
}
function patchHydrate(html, { slug, itemId }) {
  return html.replace(/(<div id="main"[^>]*?data-framer-hydrate-v2=")([^"]*)(")/, (m, a, b, c) => {
    try {
      const d = JSON.parse(b.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      if (d.pathVariables) for (const k of Object.keys(d.pathVariables)) d.pathVariables[k] = slug;
      if (itemId) d.collectionItemId = itemId;
      return a + JSON.stringify(d).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + c;
    } catch { return m; }
  });
}
function emptyMain(html) {
  const i = html.indexOf('<div id="main"');
  if (i === -1) return html;
  const j = html.indexOf('>', i) + 1;
  let depth = 1, k = j;
  while (depth > 0) {
    const o = html.indexOf('<div', k), c = html.indexOf('</div>', k);
    if (c === -1) return html;
    if (o !== -1 && o < c) { depth++; k = o + 4; } else { depth--; k = c + 6; }
  }
  // Keep Framer's <style> blocks (it puts most page CSS inside #main):
  // without them the new page shows unstyled until JavaScript re-adds them
  const styles = html.slice(j, k - 6).match(/<style\b[\s\S]*?<\/style>/gi) || [];
  return html.slice(0, j) + styles.join('') + html.slice(k - 6);
}
// Text edits are written into the saved HTML so the page shows them before
// (and without) JavaScript. Matching must be strict: a short value like "d"
// must never replace letters inside other words ("el Matador").
const wordRe = t => new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(t)}(?=$|[^\\p{L}\\p{N}])`, 'gu');
function replaceInHead(html, oldText, newText) {
  if (!oldText || oldText === newText || String(oldText).trim().length < 2) return html;
  const head = html.match(/<head[\s\S]*?<\/head>/i);
  if (!head) return html;
  const swap = (v, from, to) => v.replace(wordRe(from), (m, pre) => pre + to);
  let h = head[0];
  h = h.replace(/<title>([\s\S]*?)<\/title>/i, (m, t) => `<title>${swap(t, escHtml(oldText), escHtml(newText))}</title>`);
  h = h.replace(/(<meta[^>]+content=")([^"]*)(")/gi, (m, a, v, c) => a + swap(v, escAttr(oldText), escAttr(newText)) + c);
  return html.replace(head[0], () => h);
}
function replaceBodyText(html, oldText, newText) {
  // Very short values ("e", "12") also exist as single letters in animated
  // text (one letter per tag) — leave those to React, which renders the new
  // value as soon as the page loads.
  if (!oldText || oldText === newText || String(oldText).trim().length < 3) return html;
  // Visible text only: the <body>, skipping <script>/<style>/<template> blocks,
  // and only text that is exactly the old value (a whole text node).
  const bodyAt = html.search(/<body[\s>]/i);
  if (bodyAt === -1) return html;
  const re = new RegExp(`>(\\s*)${reEsc(escHtml(oldText))}(\\s*)<`, 'g');
  const body = html.slice(bodyAt).split(/(<(script|style|template)\b[\s\S]*?<\/\2>)/i);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const part = body[i];
    if (i % 3 === 2) continue; // captured tag name from the split
    out += i % 3 === 1 ? part : part.replace(re, (m, a, b) => `>${a}${escHtml(newText)}${b}<`);
  }
  return html.slice(0, bodyAt) + out;
}

// Image edits must be written into the saved HTML too: when Framer hydrates
// a page, React keeps the <img> addresses already in the HTML, so a changed
// image would keep showing the old picture. Images are matched by their file
// "stem" (Framer image id or upload name), which every resized copy shares.
const imgSrcOf = v => (v && v.t === 'image' && v.v ? (typeof v.v === 'string' ? v.v : v.v.src) : null);
const imgStem = src => String(src || '').split('?')[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/-\d+$/, '');
const fileOf = u => String(u || '').split('?')[0].split('#')[0].split('/').pop();
function swapImages(html, swaps) {
  if (!swaps.length || typeof html !== 'string') return html;
  const bodyAt = html.search(/<body[\s>]/i);
  if (bodyAt === -1) return html;
  const body = html.slice(bodyAt).replace(/<img\b[^>]*>/gi, tag => {
    // Images this CMS changed before carry a marker (item/field) — the most
    // reliable match. Otherwise match the EXACT local file names the old image
    // became (never partial names: primary-5.png is not primary-6.png).
    const mark = (tag.match(/\sdata-fx-f="([^"]*)"/) || [])[1];
    let sw = mark && swaps.find(x => x.key === mark);
    if (!sw && !mark) {
      const names = new Set();
      const src = (tag.match(/\ssrc="([^"]*)"/) || [])[1];
      if (src) names.add(fileOf(src));
      ((tag.match(/\ssrcset="([^"]*)"/) || [])[1] || '').split(',').forEach(p => { const u = p.trim().split(/\s+/)[0]; if (u) names.add(fileOf(u)); });
      sw = swaps.find(x => x.names.some(n => names.has(n)));
    }
    if (!sw) return tag;
    let t = tag.replace(/\s(srcset|sizes|data-fx-f)="[^"]*"/gi, '');
    const src = ` src="${escAttr(sw.src)}"`;
    t = /\ssrc="[^"]*"/i.test(t) ? t.replace(/\ssrc="[^"]*"/i, src) : t.replace(/^<img/i, '<img' + src);
    return sw.key ? t.replace(/^<img/i, `<img data-fx-f="${escAttr(sw.key)}"`) : t;
  });
  return html.slice(0, bodyAt) + body;
}
// Exact local file names an image value appears as on the pages
function namesOf(src, manifest) {
  const base = String(src).split('?')[0];
  const out = new Set([fileOf(base)]);
  const id = fileOf(base).replace(/\.[a-z0-9]+$/i, '');
  (manifest?.imageFiles?.[id] || []).forEach(n => out.add(n));
  const mapped = manifest?.imageMap?.[base];
  if (mapped) out.add(fileOf(mapped));
  return [...out].filter(Boolean);
}
// Same problem for links and files: React keeps the old href from the HTML
const hrefOf = v => (v && (v.t === 'link' || v.t === 'file') && v.v ? (typeof v.v === 'string' ? v.v : v.v.url || v.v.href || '') : '');
function swapHrefs(html, swaps) {
  if (!swaps.length || typeof html !== 'string') return html;
  const bodyAt = html.search(/<body[\s>]/i);
  if (bodyAt === -1) return html;
  const body = html.slice(bodyAt).replace(/<a\b[^>]*>/gi, tag => {
    const sw = swaps.find(x => tag.includes(`href="${escAttr(x.from)}"`));
    return sw ? tag.replace(`href="${escAttr(sw.from)}"`, `href="${escAttr(sw.to)}"`) : tag;
  });
  return html.slice(0, bodyAt) + body;
}
function imageSwapsOf(collections, manifest) {
  const swaps = [], links = [];
  swaps.texts = [];
  const imgsOf = v => (v && v.t === 'array' ? v.v.map(imgSrcOf) : [imgSrcOf(v)]);
  for (const col of collections) for (const it of col.items) {
    if (it.status !== 'edited') continue;
    for (const f of col.fields) {
      const bv = it.orig?.[f.id], av = it.data[f.id];
      // single images and image galleries (arrays), matched position by position
      const bs = imgsOf(bv), as = imgsOf(av);
      bs.forEach((before, i) => {
        const after = as[i];
        if (!before || !after || before === after) return;
        swaps.push({ names: namesOf(before, manifest), src: after, key: `${it.key}/${f.id}${bs.length > 1 ? '/' + i : ''}` });
      });
      if (bv?.t === 'string' && av?.t === 'string' && bv.v !== av.v && f.id !== col.slugFieldId && String(bv.v).trim().length >= 3) swaps.texts.push({ from: bv.v, to: av.v });
      const isUrl = x => x && x.t === 'string' && /^(https?:|mailto:|tel:)/i.test(String(x.v || ''));
      const hb = hrefOf(bv) || (isUrl(bv) ? bv.v : ''), ha = hrefOf(av) || (isUrl(av) ? av.v : '');
      if (hb && ha && hb !== ha) links.push({ from: hb, to: ha });
    }
  }
  swaps.links = links;
  return swaps;
}
// Every page that shows an edited item (lists, related items) gets the edits
function applySwaps(html, swaps) {
  let h = swapHrefs(swapImages(html, swaps), swaps.links);
  for (const t of swaps.texts) h = replaceBodyText(h, t.from, t.to);
  return h;
}

// ── Build: compute every file change for the current edits ───────────────────
// Returns Map(path → string | Uint8Array | null)  (null = delete)
export async function buildChanges(state, uploads = new Map(), opts = {}) {
  const { manifest } = state;
  const changes = new Map();
  // Work on copies: building must never mutate the editor's state
  const dirty = state.collections.filter(isDirty).map(c => ({
    ...c, items: c.items.map(i => ({ ...i, data: structuredClone(i.data) })),
  }));
  if (!dirty.length && !uploads.size) return changes;
  const swaps = imageSwapsOf(dirty, manifest);
  const useCache = !!opts.cache;
  const read = p => readText(p, { cache: useCache });

  const pageCache = new Map();
  const getPage = async p => {
    if (changes.has(pageFile(p)) && typeof changes.get(pageFile(p)) === 'string') return changes.get(pageFile(p));
    if (!pageCache.has(p)) pageCache.set(p, await read(pageFile(p)));
    return pageCache.get(p);
  };
  const setPage = (p, html) => changes.set(pageFile(p), html);

  let pages = [...manifest.pages];
  const newManifest = structuredClone(manifest);

  for (const col of dirty) {
    const mcol = newManifest.collections.find(c => c.id === col.id);
    const live = col.items.filter(i => i.status !== 'deleted');
    const now = new Date().toISOString();

    // Keep Framer's previous/next links consistent with the list order
    const hasPrev = live.some(i => 'previousItemId' in i.data), hasNext = live.some(i => 'nextItemId' in i.data);
    live.forEach((it, idx) => {
      if (hasPrev) it.data.previousItemId = idx > 0 ? { t: 'string', v: live[idx - 1].data.id.v } : { t: 'null', v: null };
      if (hasNext) it.data.nextItemId = idx < live.length - 1 ? { t: 'string', v: live[idx + 1].data.id.v } : { t: 'null', v: null };
      if (it.status !== 'clean' && 'updatedAt' in it.data) it.data.updatedAt = { t: 'date', v: now };
    });

    // 1. Data: everything into the first default chunk, other chunks emptied
    const defaults = col.chunks.filter(c => c.locale === 'default');
    const use = defaults.length ? defaults : col.chunks;
    use.forEach((ch, i) => changes.set(ch.file, encodeChunk(i === 0 ? live.map(i => i.data) : [])));

    // 2. Module: drop indexes so Framer scans the new data
    try {
      const js = await read(col.modulePath);
      if (/indexes:\[(?!\])/.test(js)) changes.set(col.modulePath, stripIndexes(js));
    } catch (e) { console.warn('[admin] module', e); }

    // 3–5. Pages
    const prefix = col.pagePrefix; // e.g. "work"
    const templatePath = col.templatePage && pages.includes(col.templatePage) ? col.templatePage
      : Object.values(mcol.itemPages || {})[0];
    mcol.itemPages = mcol.itemPages || {};

    for (const it of col.items) {
      const id = it.data.id?.v;
      const slug = itemSlug(col, it);
      const oldPage = it.page;
      const extras = (mcol.extraPages && mcol.extraPages[id]) || [];
      if (it.status === 'deleted') {
        for (const p of [oldPage, ...extras].filter(Boolean)) { changes.set(pageFile(p), null); pages = pages.filter(x => x !== p); }
        delete mcol.itemPages[id];
        if (mcol.extraPages) delete mcol.extraPages[id];
        continue;
      }
      // Extra page templates (e.g. /blog/:slug/amp) follow the item's slug
      if (it.status === 'edited' && extras.length && oldPage && col.pagePrefix) {
        const oldSlug = it.orig && col.slugFieldId && it.orig[col.slugFieldId]?.v;
        const newSlug = itemSlug(col, it);
        const moved = [];
        for (const p of extras) {
          let html = stripHandover(await getPage(p));
          let target = p;
          if (oldSlug && newSlug && oldSlug !== newSlug) {
            target = p.replace(`${col.pagePrefix}/${oldSlug}`, `${col.pagePrefix}/${newSlug}`);
            html = patchHydrate(setPagePath(html, target), { slug: newSlug, itemId: id });
            if (target !== p) { changes.set(pageFile(p), null); pages = pages.filter(x => x !== p); if (!pages.includes(target)) pages.push(target); }
          }
          for (const f of col.fields) {
            const b = it.orig?.[f.id], a = it.data[f.id];
            if (b?.t === 'string' && a?.t === 'string' && b.v !== a.v) { html = replaceInHead(html, b.v, a.v); html = replaceBodyText(html, b.v, a.v); }
          }
          setPage(target, html);
          moved.push(target);
        }
        mcol.extraPages[id] = moved;
      }
      if (!prefix || !col.slugFieldId) continue; // collection has no item pages
      const wantPage = `${prefix}/${slug}`;
      if (it.status === 'new' || (oldPage && oldPage !== wantPage)) {
        // Moved item (slug changed) → start from its own page; new item → a sibling's
        const source = it.status === 'new' ? templatePath : oldPage;
        if (!source) continue;
        let html = await getPage(source);
        html = stripHandover(html);
        html = setPagePath(html, wantPage);
        html = patchHydrate(html, { slug, itemId: id });
        // Head: swap the source item's title for this one
        const srcItem = it.status === 'new' ? col.items.find(x => x.page === source) : it;
        if (srcItem) html = replaceInHead(html, itemTitle(col, { data: srcItem.orig || srcItem.data }), itemTitle(col, it));
        if (it.status === 'new') {
          html = emptyMain(html); // brand-new item: Framer renders it client-side
        } else {
          // Same item, new address: keep its pre-rendered content (no blank
          // page) and apply any text edits made alongside the slug change.
          for (const f of col.fields) {
            const bv = it.orig?.[f.id], av = it.data[f.id];
            if (bv?.t === 'string' && av?.t === 'string' && bv.v !== av.v && f.id !== col.slugFieldId) {
              html = replaceInHead(html, bv.v, av.v);
              html = replaceBodyText(html, bv.v, av.v);
            }
          }
        }
        setPage(wantPage, html);
        if (oldPage && oldPage !== wantPage) { changes.set(pageFile(oldPage), null); pages = pages.filter(p => p !== oldPage); }
        if (!pages.includes(wantPage)) pages.push(wantPage);
        mcol.itemPages[id] = wantPage;
        continue;
      }
      if (it.status === 'edited' && oldPage) {
        let html = await getPage(oldPage);
        html = stripHandover(html);
        for (const f of col.fields) {
          const before = it.orig?.[f.id], after = it.data[f.id];
          if (!before || !after) continue;
          if (before.t === 'string' && after.t === 'string' && before.v !== after.v) {
            html = replaceInHead(html, before.v, after.v);
            html = replaceBodyText(html, before.v, after.v);
          }
        }
        setPage(oldPage, html);
      }
    }
  }

  // Every remaining page: remove embedded query data so lists show new content
  if (dirty.length) {
    for (const p of pages) {
      if (changes.has(pageFile(p))) continue;
      try {
        const html = await getPage(p);
        const next = applySwaps(stripHandover(html), swaps);
        if (next !== html) setPage(p, next);
      } catch {}
    }
    // Item pages built above get the same image swaps
    if (swaps.length || swaps.links.length || swaps.texts.length) for (const [k, v] of changes) if (k.endsWith('.html') && typeof v === 'string') changes.set(k, applySwaps(v, swaps));
  }

  // Uploaded files — only the ones still used (an image replaced twice before
  // publishing shouldn't leave its first version behind on the site)
  if (uploads.size) {
    const used = JSON.stringify(state.collections.map(c => c.items.filter(i => i.status !== 'deleted').map(i => i.data)));
    for (const [path, bytes] of uploads) if (used.includes(path)) changes.set(path, bytes);
  }

  // Sitemap
  if (dirty.length) {
    try {
      const sm = await read('sitemap.xml');
      const base = (sm.match(/<loc>(https?:\/\/[^<]*?)\/(?:[^<]*)<\/loc>/) || [])[1];
      if (base) {
        const head = sm.slice(0, sm.indexOf('<urlset'));
        const urls = ['', ...pages.filter(p => p && p !== '404')].map(p => `  <url><loc>${base}/${encodeURI(p)}</loc></url>`).join('\n');
        changes.set('sitemap.xml', `${head}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
      }
    } catch {}
  }

  newManifest.pages = pages;
  newManifest.updatedAt = new Date().toISOString();
  changes.set('cms/fx-site.json', JSON.stringify(newManifest, null, 2));

  if (opts.extraFiles) for (const [p, c] of opts.extraFiles(state, newManifest)) changes.set(p, c);
  // Don't re-send data files that are already identical on the site (other
  // collections' CSV/JSON, an unchanged sitemap): fewer uploads, faster publish
  for (const [p, c] of [...changes]) {
    if (typeof c !== 'string' || !/^(cms\/data\/|sitemap\.xml$)/.test(p)) continue;
    try { if ((await read(p)) === c) changes.delete(p); } catch {}
  }
  return changes;
}

// Someone published from another tab or device since this session loaded.
// Take their latest content and re-apply only THIS session's own edits, field
// by field — so neither side's work is silently overwritten.
export function rebaseEdits(latest, current) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const urlChanged = current.manifest.liveUrl !== (current.manifest._liveUrlSaved ?? current.manifest.liveUrl);
  return {
    ...latest,
    manifest: { ...latest.manifest, liveUrl: urlChanged ? current.manifest.liveUrl : latest.manifest.liveUrl, _liveUrlSaved: latest.manifest.liveUrl },
    collections: latest.collections.map(lc => {
      const cc = current.collections.find(c => c.id === lc.id);
      if (!cc) return lc;
      const mine = new Map(cc.items.map(i => [i.key, i]));
      const items = lc.items.map(li => {
        const ci = mine.get(li.key);
        if (!ci || ci.status === 'clean') return li;
        if (ci.status === 'deleted') return { ...li, status: 'deleted' };
        const data = structuredClone(li.data);
        for (const k of Object.keys(ci.data)) if (!same(ci.data[k], ci.orig?.[k])) data[k] = ci.data[k];
        return { ...li, data, status: same(data, li.orig) ? 'clean' : 'edited' };
      });
      const known = new Set(lc.items.map(i => i.key));
      for (const ci of cc.items) if (ci.status === 'new' && !known.has(ci.key)) items.push(ci);
      return { ...lc, items };
    }),
  };
}

// After a successful publish, the edited state becomes the new baseline.
export function commitState(state, changes) {
  const manifestText = changes.get('cms/fx-site.json');
  const manifest = manifestText ? JSON.parse(manifestText) : state.manifest;
  const collections = state.collections.map(c => {
    const mc = manifest.collections.find(x => x.id === c.id) || c;
    return {
      ...c,
      itemPages: mc.itemPages,
      items: c.items.filter(i => i.status !== 'deleted').map(i => ({
        ...i, orig: structuredClone(i.data), status: 'clean', page: mc.itemPages?.[i.data.id?.v] || null,
      })),
    };
  });
  return { manifest, collections };
}

export { richTextToHtml, richTextToPlain };
