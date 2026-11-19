// Framer rich text ⇄ HTML.
// Framer stores rich text as a compact JSON tree:
//   [1, ...children]                 Fragment
//   [2, linkProps, ...children]      Link to a Framer page
//   [3, moduleId, props, treeKeys]   Embedded component (YouTube, Video…)
//   [4, tag, props, ...children]     HTML element  ("a" becomes a Framer link)
//   [5, "text"]                      Text
// The editor works on HTML; embeds are kept as opaque, non-editable blocks
// carrying their original JSON so nothing is lost on save.

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VOID = new Set(['img', 'br', 'hr']);
const SAFE_ATTRS = ['href', 'src', 'alt', 'title', 'target', 'rel'];

function treeToHtml(n) {
  if (n == null) return '';
  if (typeof n === 'string') return esc(n);
  if (!Array.isArray(n)) return '';
  switch (n[0]) {
    case 1: return n.slice(1).map(treeToHtml).join('');
    case 2: {
      // Internal Framer link: keep the original props so it round-trips
      const props = n[1] || {};
      return `<a data-fx-link="${esc(JSON.stringify(props))}" href="${esc(props.href || '#')}">${n.slice(2).map(treeToHtml).join('')}</a>`;
    }
    case 3: {
      const label = String(n[1] || '').split(':').pop() || 'Embed';
      const url = n[2] && (n[2].url || n[2].srcUrl || n[2].src);
      return `<div class="fx-embed" contenteditable="false" data-fx-embed="${esc(JSON.stringify(n))}">${esc(label)}${url ? ': ' + esc(url) : ''}</div>`;
    }
    case 4: {
      const tag = String(n[1] || 'div').toLowerCase().replace(/[^a-z0-9]/g, '') || 'div';
      const p = n[2] || {};
      let attrs = '';
      if (p.className) attrs += ` class="${esc(p.className)}"`;
      SAFE_ATTRS.forEach(k => { if (typeof p[k] === 'string') attrs += ` ${k}="${esc(p[k])}"`; });
      // Remember the original props (styles, data-*) so untouched nodes round-trip
      const extra = { ...p };
      ['className', ...SAFE_ATTRS].forEach(k => delete extra[k]);
      if (Object.keys(extra).length) attrs += ` data-fx-props="${esc(JSON.stringify(extra))}"`;
      if (VOID.has(tag)) return `<${tag}${attrs}>`;
      return `<${tag}${attrs}>${n.slice(3).map(treeToHtml).join('')}</${tag}>`;
    }
    case 5: return esc(n[1] ?? '');
    default: return '';
  }
}

export function richTextToHtml(value) {
  if (typeof value !== 'string') return '';
  const t = value.trim();
  if (!t) return '';
  if (t[0] !== '[') return value; // already HTML
  try { return treeToHtml(JSON.parse(t)); } catch { return ''; }
}

// DOM → tree. Only allow tags Framer's rich text supports.
const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'a',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'br', 'hr', 'img', 'div', 'span', 'figure', 'figcaption', 'sup', 'sub']);
const RENAME = { b: 'strong', i: 'em' };

function nodeToTree(node) {
  if (node.nodeType === 3) {
    const text = node.nodeValue;
    return text ? [5, text] : null;
  }
  if (node.nodeType !== 1) return null;
  const el = node;
  if (el.dataset && el.dataset.fxEmbed) {
    try { return JSON.parse(el.dataset.fxEmbed); } catch { return null; }
  }
  const children = [...el.childNodes].map(nodeToTree).filter(Boolean);
  if (el.dataset && el.dataset.fxLink) {
    let props = {};
    try { props = JSON.parse(el.dataset.fxLink); } catch {}
    if (el.getAttribute('href') && el.getAttribute('href') !== props.href) props = { ...props, href: el.getAttribute('href') };
    return [2, props, ...children];
  }
  let tag = el.tagName.toLowerCase();
  tag = RENAME[tag] || tag;
  if (!ALLOWED.has(tag)) {
    // Unknown wrapper (e.g. font tag from paste): keep its children only
    return children.length === 1 ? children[0] : (children.length ? [1, ...children] : null);
  }
  let props = null;
  if (el.dataset && el.dataset.fxProps) { try { props = JSON.parse(el.dataset.fxProps); } catch {} }
  const cls = el.getAttribute('class');
  if (cls && !cls.startsWith('fx-')) props = { ...(props || {}), className: cls };
  SAFE_ATTRS.forEach(k => { const v = el.getAttribute(k); if (v != null) props = { ...(props || {}), [k]: v }; });
  return [4, tag, props, ...children];
}

export function htmlToRichText(html) {
  const doc = new DOMParser().parseFromString(`<div id="r">${html || ''}</div>`, 'text/html');
  const root = doc.getElementById('r');
  // Wrap stray top-level text in paragraphs so Framer styles it
  const kids = [];
  let inline = [];
  const flush = () => { if (inline.length) { kids.push([4, 'p', null, ...inline]); inline = []; } };
  for (const n of root.childNodes) {
    const t = nodeToTree(n);
    if (!t) continue;
    const isInline = t[0] === 5 || (t[0] === 4 && ['strong', 'em', 'u', 's', 'a', 'code', 'span', 'br', 'sup', 'sub'].includes(t[1])) || t[0] === 2;
    if (isInline) {
      if (t[0] === 5 && !t[1].trim() && !inline.length) continue;
      inline.push(t);
    } else { flush(); kids.push(t); }
  }
  flush();
  return JSON.stringify([1, ...kids]);
}

export function richTextToPlain(value) {
  const html = richTextToHtml(value);
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
