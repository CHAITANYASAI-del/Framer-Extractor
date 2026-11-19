// cms.js — Framer CMS decoder + human-friendly CMS export
//
// Framer ships CMS content as binary ".framercms" files. Layout (from Framer's
// own reader in its runtime):
//   chunk  = uint32 itemCount, then itemCount × item
//   item   = uint16 fieldCount, then fieldCount × (string key, value)
//   string = uint32 byteLength + UTF-8 bytes
//   value  = uint8 type tag + payload (see readValue)
// Field ids (e.g. "Hu4fZOK6v") get human titles ("Title") from the schema in
// the collection's JS module, which we parse out of the downloaded bundles.
//
// Output (inside the ZIP):  cms-content/index.html  (browsable viewer)
//                           cms-content/<collection>.json / .csv
'use strict';

var FXCms = (function () {

  // ── Binary reader ─────────────────────────────────────────────────────────
  function Reader(bytes) {
    this.b  = bytes;
    this.v  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.o  = 0;
    this.td = new TextDecoder();
  }
  Reader.prototype.need = function (n) {
    if (this.o + n > this.b.length) throw new Error('CMS data truncated');
  };
  Reader.prototype.u8  = function () { this.need(1); return this.v.getUint8(this.o++); };
  Reader.prototype.i8  = function () { this.need(1); return this.v.getInt8(this.o++); };
  Reader.prototype.u16 = function () { this.need(2); var x = this.v.getUint16(this.o); this.o += 2; return x; };
  Reader.prototype.u32 = function () { this.need(4); var x = this.v.getUint32(this.o); this.o += 4; return x; };
  Reader.prototype.i64 = function () { this.need(8); var x = Number(this.v.getBigInt64(this.o)); this.o += 8; return x; };
  Reader.prototype.f64 = function () { this.need(8); var x = this.v.getFloat64(this.o); this.o += 8; return x; };
  Reader.prototype.str = function () {
    var n = this.u32(); this.need(n);
    var s = this.td.decode(this.b.subarray(this.o, this.o + n)); this.o += n; return s;
  };
  Reader.prototype.json = function () {
    var s = this.str(); try { return JSON.parse(s); } catch (e) { return s; }
  };

  // Type tags match Framer's runtime (Array=1 … VectorSetItem=13)
  function readValue(r) {
    var tag = r.u8(), n, out, i;
    switch (tag) {
      case 0:  return { t: 'null', v: null };
      case 1:  n = r.u16(); out = []; for (i = 0; i < n; i++) out.push(readValue(r)); return { t: 'array', v: out };
      case 2:  return { t: 'boolean', v: r.u8() !== 0 };
      case 3:  return { t: 'color', v: r.str() };
      case 4:  return { t: 'date', v: new Date(r.i64()).toISOString() };
      case 5:  return { t: 'enum', v: r.str() };
      case 6:  return { t: 'file', v: r.str() };
      case 7:  return { t: 'link', v: r.json() };
      case 8:  return { t: 'number', v: r.f64() };
      case 9:  n = r.u16(); out = {}; for (i = 0; i < n; i++) { var k = r.str(); out[k] = readValue(r); } return { t: 'object', v: out };
      case 10: return { t: 'image', v: r.json() };
      case 11: return r.i8() === 0 ? { t: 'richtextRef', v: r.u32() } : { t: 'richtext', v: r.str() };
      case 12: return { t: 'string', v: r.str() };
      case 13: return { t: 'vector', v: r.u32() };
      default: throw new Error('Unknown CMS value type ' + tag);
    }
  }

  function decodeChunk(bytes) {
    var r = new Reader(bytes), count = r.u32(), items = [];
    for (var i = 0; i < count; i++) {
      var fc = r.u16(), item = {};
      for (var j = 0; j < fc; j++) { var key = r.str(); item[key] = readValue(r); }
      items.push(item);
    }
    return items;
  }

  // ── Schema discovery from Framer JS bundles ───────────────────────────────
  // In the bundle each collection looks like:
  //   collectionByLocaleId:{default:new X({chunks:[new URL(`./ID-chunk-default-0.framercms`,…)…]…})},
  //   displayName:`Work`,id:`uuid`},_(var,{fieldId:{…title:`Title`,type:D.String},…})
  function matchBrace(text, start) { // start = index of '{'
    var depth = 0, q = null;
    for (var i = start; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '`' || c === '"' || c === "'") { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  // scriptTexts: array of strings, or of { text, path } (path = file in the export)
  function parseCollections(scriptTexts) {
    var byModule = {};
    scriptTexts.forEach(function (entry) {
      var text = typeof entry === 'string' ? entry : entry && entry.text;
      var modulePath = typeof entry === 'string' ? null : entry && entry.path;
      if (!text || text.indexOf('collectionByLocaleId') === -1) return;
      var idx = 0;
      while ((idx = text.indexOf('collectionByLocaleId', idx)) !== -1) {
        var dn = text.indexOf('displayName:', idx);
        if (dn === -1) break;
        var region = text.slice(idx, dn);
        var chunkRe = /\.\/([A-Za-z0-9_-]+?)-chunk-([A-Za-z0-9_-]+?)-(\d+)\.framercms/g, m, chunks = [], moduleId = null;
        while ((m = chunkRe.exec(region)) !== null) {
          moduleId = moduleId || m[1];
          chunks.push({ file: m[1] + '-chunk-' + m[2] + '-' + m[3] + '.framercms', locale: m[2] });
        }
        var nameM = /displayName:\s*[`"']([^`"']*)[`"']/.exec(text.slice(dn, dn + 300));
        var name  = nameM ? nameM[1] : (moduleId || 'Collection');
        // Schema object: first "_(ident,{" after displayName
        var fields = {};
        var after  = text.slice(dn, dn + 600);
        var sm = /\}\s*,\s*[A-Za-z_$][\w$]*\(\s*[A-Za-z_$][\w$]*\s*,\s*\{/.exec(after);
        if (sm) {
          var open = dn + sm.index + sm[0].length - 1;
          var close = matchBrace(text, open);
          if (close > open) {
            var schemaText = text.slice(open, close + 1);
            // Each field: id:{ …title:`Title`, type:D.String, dataIdentifier:`local-module:collection/ID:default` … }
            var fRe = /([A-Za-z0-9_$]+):\{([^{}]*)\}/g, f;
            while ((f = fRe.exec(schemaText)) !== null) {
              var body = f[2];
              var tm = /title:\s*[`"']([^`"']*)[`"']/.exec(body), ty = /type:\s*[\w$]+\.(\w+)/.exec(body);
              if (!tm || !ty) continue;
              var field = { title: tm[1], type: ty[1] };
              var di = /dataIdentifier:\s*[`"'][^`"']*collection\/([A-Za-z0-9_-]+)/.exec(body);
              if (di) field.ref = di[1];
              fields[f[1]] = field;
            }
          }
        }
        if (moduleId && chunks.length) {
          var existing = byModule[moduleId];
          if (!existing || Object.keys(fields).length > Object.keys(existing.fields).length) {
            byModule[moduleId] = { moduleId: moduleId, name: name, chunks: chunks, fields: fields, modulePath: modulePath };
          }
        }
        idx = dn + 1;
      }
    });
    return Object.keys(byModule).map(function (k) { return byModule[k]; });
  }

  // ── Rich text: Framer stores it as a compact JSON tree, not HTML ──────────
  //   [1, ...children]                 Fragment
  //   [2, linkProps, ...children]      Link
  //   [3, moduleId, props, treeKeys]   Embedded component (YouTube, etc.)
  //   [4, tag, props, ...children]     HTML element
  //   [5, "text"]                      Text
  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  var VOID = { img: 1, br: 1, hr: 1 };
  function treeToHtml(n) {
    if (n == null) return '';
    if (typeof n === 'string') return escHtml(n);
    if (!Array.isArray(n)) return '';
    switch (n[0]) {
      case 1: return n.slice(1).map(treeToHtml).join('');
      case 2: {
        var lp = n[1] || {}, href = lp.href || lp.url || (typeof lp.webPageId === 'string' ? '#' : '#');
        return '<a href="' + escHtml(href) + '">' + n.slice(2).map(treeToHtml).join('') + '</a>';
      }
      case 3: {
        var mod = String(n[1] || ''), props = n[2] || {};
        var label = (mod.split(':').pop() || 'Component');
        if (props.url) return '<p><a href="' + escHtml(props.url) + '">' + escHtml(label) + ': ' + escHtml(props.url) + '</a></p>';
        return '<!-- embedded ' + escHtml(label) + ' -->';
      }
      case 4: {
        var tag = String(n[1] || 'div').toLowerCase().replace(/[^a-z0-9]/g, '') || 'div';
        var p = n[2] || {}, attrs = '';
        if (p.className) attrs += ' class="' + escHtml(p.className) + '"';
        ['href', 'src', 'alt', 'title', 'target', 'rel'].forEach(function (k) {
          if (typeof p[k] === 'string') attrs += ' ' + k + '="' + escHtml(p[k]) + '"';
        });
        if (VOID[tag]) return '<' + tag + attrs + '>';
        return '<' + tag + attrs + '>' + n.slice(3).map(treeToHtml).join('') + '</' + tag + '>';
      }
      case 5: return escHtml(n[1] == null ? '' : n[1]);
      default: return '';
    }
  }
  function richTextToHtml(s) {
    if (typeof s !== 'string') return s;
    var t = s.trim();
    if (t.charAt(0) !== '[') return s; // already HTML
    try { return treeToHtml(JSON.parse(t)); } catch (e) { return s; }
  }

  // ── Value → plain export value ────────────────────────────────────────────
  function stripQuery(u) { return String(u || '').split('?')[0]; }

  function localFor(url, ctx) {
    if (!url) return null;
    if (ctx.urlMap[url]) return ctx.urlMap[url];
    var base = stripQuery(url);
    return ctx.baseMap[base] || null;
  }

  function plain(val, ctx) {
    if (!val) return null;
    switch (val.t) {
      case 'null': return null;
      case 'array': return val.v.map(function (x) { return plain(x, ctx); });
      case 'object': var o = {}; Object.keys(val.v).forEach(function (k) { o[k] = plain(val.v[k], ctx); }); return o;
      case 'image':
        var src = val.v && (val.v.src || val.v.url) || (typeof val.v === 'string' ? val.v : null);
        return { url: src, local: localFor(src, ctx), alt: (val.v && val.v.alt) || '' };
      case 'file': return { url: val.v, local: localFor(val.v, ctx) };
      case 'link':
        if (val.v && typeof val.v === 'object') return val.v.url || val.v.href || JSON.stringify(val.v);
        return val.v;
      case 'richtextRef': return { richText: 'stored separately — see the item page' };
      case 'richtext': return richTextToHtml(val.v);
      default: return val.v;
    }
  }

  function toCell(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(toCell).join(' | ');
    if (typeof v === 'object') {
      if ('ref' in v) return v.slug || v.title || v.ref; // Framer CSV import matches references by slug
      if ('url' in v) return v.url || '';
      if ('richText' in v) return '';
      return JSON.stringify(v);
    }
    return String(v);
  }

  function csvEscape(s) {
    s = String(s);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'collection';
  }

  // ── Build export ──────────────────────────────────────────────────────────
  // collections: from parseCollections
  // chunkBytes:  { "ID-chunk-default-0.framercms": Uint8Array }
  // pagePaths:   ["work/noir", …] exported page paths
  // urlMap:      original URL → local path
  function buildExport(collections, chunkBytes, pagePaths, urlMap) {
    var ctx = { urlMap: urlMap || {}, baseMap: {} };
    Object.keys(ctx.urlMap).forEach(function (u) {
      var b = stripQuery(u);
      if (!ctx.baseMap[b]) ctx.baseMap[b] = ctx.urlMap[u];
    });
    var byLast = {};
    (pagePaths || []).forEach(function (p) { var last = p.split('/').pop(); (byLast[last] = byLast[last] || []).push(p); });

    var files = {}, summary = [], usedNames = {};

    // Pass 1: decode every collection, and index items by id so reference
    // fields ("Category" → item id) can show the referenced item's title/slug.
    var decoded = [], idIndex = {};
    collections.forEach(function (col) {
      var defaultChunks = col.chunks.filter(function (c) { return c.locale === 'default'; });
      var use = defaultChunks.length ? defaultChunks : col.chunks;
      var raw = [], failed = 0;
      use.forEach(function (c) {
        var bytes = chunkBytes[c.file];
        if (!bytes) { failed++; return; }
        try { raw = raw.concat(decodeChunk(bytes)); } catch (e) { failed++; }
      });
      decoded.push({ col: col, use: use, raw: raw, failed: failed });
      var titleKey = null, slugKey0 = null;
      Object.keys(col.fields).forEach(function (k) {
        var t = col.fields[k].title, ty = col.fields[k].type;
        if (!titleKey && /^(title|name)$/i.test(t) && ty === 'String') titleKey = k;
        if (!slugKey0 && /^slug$/i.test(t)) slugKey0 = k;
      });
      raw.forEach(function (it) {
        if (!it.id || it.id.t !== 'string') return;
        idIndex[it.id.v] = {
          title: titleKey && it[titleKey] ? String(it[titleKey].v) : null,
          slug:  slugKey0 && it[slugKey0] ? String(it[slugKey0].v) : null,
          collection: col.name,
        };
      });
    });
    function resolveRef(v) {
      if (Array.isArray(v)) return v.map(resolveRef);
      if (typeof v !== 'string' || !idIndex[v]) return v;
      var r = idIndex[v];
      return { ref: v, title: r.title || r.slug || v, slug: r.slug, collection: r.collection };
    }

    decoded.forEach(function (d) {
      var col = d.col, use = d.use, raw = d.raw, failed = d.failed;
      if (!raw.length) return;

      // Column order: schema order, then any extra keys seen in data
      var keys = Object.keys(col.fields).filter(function (k) { return k !== 'previousItemId' && k !== 'nextItemId'; });
      raw.forEach(function (it) { Object.keys(it).forEach(function (k) {
        if (keys.indexOf(k) === -1 && k !== 'previousItemId' && k !== 'nextItemId') keys.push(k);
      }); });
      if (keys.indexOf('id') > 0) { keys.splice(keys.indexOf('id'), 1); keys.unshift('id'); }
      var titleOf = function (k) { return (col.fields[k] && col.fields[k].title) || (k === 'id' ? 'ID' : k); };
      var typeOf  = function (k) { return (col.fields[k] && col.fields[k].type) || ''; };
      var slugKey = keys.find(function (k) { return /^slug$/i.test(titleOf(k)); });

      var items = raw.map(function (it) {
        var row = {};
        keys.forEach(function (k) {
          var pv = plain(it[k], ctx);
          if (/CollectionReference/.test(typeOf(k))) pv = resolveRef(pv);
          row[titleOf(k)] = pv;
        });
        var slug = slugKey && it[slugKey] ? String(it[slugKey].v) : null;
        var page = slug && byLast[slug] && byLast[slug].length === 1 ? byLast[slug][0] : null;
        if (slug && !page && byLast[slug]) page = byLast[slug][0];
        return { page: page ? page : null, fields: row };
      });

      var base = slugify(col.name);
      if (usedNames[base]) base = base + '-' + col.moduleId;
      usedNames[base] = true;

      var columns = keys.map(titleOf);
      files['cms/data/' + base + '.json'] = JSON.stringify({
        collection: col.name,
        exportedAt: new Date().toISOString(),
        fields: keys.map(function (k) { return { id: k, title: titleOf(k), type: typeOf(k) }; }),
        items: items.map(function (i) { return Object.assign({ _page: i.page ? '/' + i.page : null }, i.fields); }),
      }, null, 2);

      var csv = [columns.map(csvEscape).join(',')];
      items.forEach(function (i) { csv.push(columns.map(function (c) { return csvEscape(toCell(i.fields[c])); }).join(',')); });
      files['cms/data/' + base + '.csv'] = '\uFEFF' + csv.join('\r\n');

      summary.push({
        name: col.name, file: base, count: items.length, failedChunks: failed,
        dataFiles: use.map(function (c) { return 'assets/cms/' + c.file; }),
        columns: keys.map(function (k) { return { title: titleOf(k), type: typeOf(k) }; }),
        items: items,
        pageFolder: (function () {
          var firstPage = items.find(function (i) { return i.page; });
          return firstPage ? firstPage.page.split('/').slice(0, -1).join('/') : null;
        })(),
      });
    });

    return { files: files, collections: summary };
  }

  // ── Viewer page (self-contained, works offline and from file://) ──────────
  function viewerHtml(summary) {
    var data = JSON.stringify(summary).replace(/</g, '\\u003c');
    return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<meta name="robots" content="noindex,nofollow"><title>CMS Content</title>' +
'<style>' +
':root{--bg:#f7f7f8;--card:#fff;--fg:#16161a;--muted:#6b6b76;--line:#e6e6ea;--accent:#0a6cff;--chip:#eef3ff}' +
'@media (prefers-color-scheme:dark){:root{--bg:#0f0f12;--card:#17171c;--fg:#ececf1;--muted:#9a9aa6;--line:#2a2a32;--accent:#5b9dff;--chip:#1c2433}}' +
'*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}' +
'.wrap{max-width:1100px;margin:0 auto;padding:28px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0}' +
'.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:16px}' +
'.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}' +
'.tabs{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.tab{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:6px 14px;cursor:pointer;font:inherit}' +
'.tab[aria-selected=true]{background:var(--accent);border-color:var(--accent);color:#fff}' +
'input{width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit;margin-top:12px}' +
'.item{display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--line)}.item:first-child{border-top:0}' +
'.thumb{width:72px;height:54px;border-radius:6px;object-fit:cover;background:var(--line);flex:none}' +
'.item-main{min-width:0;flex:1}.item-title{font-weight:600}details{margin-top:6px}summary{cursor:pointer;color:var(--muted)}' +
'table{border-collapse:collapse;width:100%;margin-top:6px;font-size:13px}td{border-top:1px solid var(--line);padding:6px 8px;vertical-align:top;word-break:break-word}td:first-child{color:var(--muted);width:160px}' +
'code{background:var(--chip);padding:1px 6px;border-radius:4px;font-size:12px}a{color:var(--accent)}' +
'.pill{display:inline-block;background:var(--chip);border-radius:999px;padding:1px 8px;font-size:12px;margin-left:6px}' +
'ol{padding-left:20px;margin:8px 0}li{margin:4px 0}' +
'.hero{display:flex;gap:14px;align-items:center;margin-top:16px;padding:16px 18px;border-radius:12px;background:linear-gradient(135deg,#0a6cff,#7c4dff);color:#fff;text-decoration:none}' +
'.hero .muted{color:rgba(255,255,255,.85)}.hero code{background:rgba(255,255,255,.18)}.hero-icon{width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.18);display:grid;place-items:center;font-size:20px;flex:none}' +
'</style></head><body><div class="wrap">' +
'<h1>Your CMS content</h1><p class="muted">Every CMS collection from your Framer site, decoded into readable data. This page is for you, not your visitors: it is set to <code>noindex</code>.</p>' +
'<a class="hero" href="../admin/"><span class="hero-icon">✎</span><span><b>Edit your content in the Site Admin →</b><br><span class="muted">Edit, add and delete items with a live preview of your site, then publish to this folder, GitHub or Vercel. Open <code>/admin</code> while the site is running.</span></span></a>' +
'<div class="grid">' +
'<div class="card"><h2>Where it lives</h2><ol>' +
'<li><b>Site Admin</b>: <code>/admin</code> — the editor for everything below.</li>' +
'<li><b>Readable copy</b> (this folder): <code>cms-content/*.csv</code> opens in Excel / Google Sheets, <code>*.json</code> for developers.</li>' +
'<li><b>Live data</b> your site actually uses: binary files in <code>assets/cms/</code> (the admin rewrites these for you).</li>' +
'<li><b>Item pages</b>: one folder per item, e.g. <code>work/noir/index.html</code>.</li></ol></div>' +
'<div class="card"><h2>Move it anywhere</h2><ol>' +
'<li><b>WordPress</b>: Admin → Integrations → download the import file → Tools → Import.</li>' +
'<li><b>Notion · Airtable · Webflow · Google Sheets</b>: Admin → Integrations → CSV made for each tool.</li>' +
'<li><b>Back into Framer</b>: CMS → Import CSV.</li></ol>' +
'<p class="muted">Edits in the admin change this exported site only — your Framer project stays as it is.</p></div>' +
'</div>' +
'<div class="tabs" id="tabs" role="tablist"></div><div class="card" id="panel"></div>' +
'</div><script>var DATA=' + data + ';' +
'var tabs=document.getElementById("tabs"),panel=document.getElementById("panel"),cur=0;' +
'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}' +
'function firstImg(f){for(var k in f){var v=f[k];if(v&&typeof v==="object"&&!Array.isArray(v)&&(v.local||v.url)&&/\\.(png|jpe?g|webp|gif|avif|svg)/i.test(v.url||v.local))return v.local?"../"+v.local:v.url}return null}' +
'function firstText(f,cols){for(var i=0;i<cols.length;i++){var v=f[cols[i].title];if(typeof v==="string"&&v&&!/^(id|slug)$/i.test(cols[i].title)&&cols[i].type!=="Date"&&cols[i].type!=="RichText")return v}return f.ID||"Untitled"}' +
'function cell(v){if(v==null)return"<span class=muted>—</span>";if(Array.isArray(v))return v.map(cell).join("<br>");if(typeof v==="object"){if(v.ref)return esc(v.title)+" <span class=muted>("+esc(v.collection)+")</span>";if(v.richText)return"<span class=muted>"+esc(v.richText)+"</span>";if(v.url||v.local){var href=v.local?"../"+v.local:v.url;return"<a href=\\""+esc(href)+"\\" target=_blank>"+esc(v.local||v.url)+"</a>"}return"<code>"+esc(JSON.stringify(v))+"</code>"}var s=String(v);if(/<[a-z][\\s\\S]*>/i.test(s))return"<div>"+s.replace(/<script[\\s\\S]*?<\\/script>/gi,"")+"</div>";return esc(s)}' +
'function render(){var c=DATA[cur],q=(document.getElementById("q")||{}).value||"";' +
'var h="<h2>"+esc(c.name)+"<span class=pill>"+c.count+" items</span></h2>";' +
'h+="<p class=muted>Spreadsheet: <a href=\\""+esc(c.file)+".csv\\">"+esc(c.file)+".csv</a> · JSON: <a href=\\""+esc(c.file)+".json\\">"+esc(c.file)+".json</a>"+(c.pageFolder?" · Pages in <code>/"+esc(c.pageFolder)+"/</code>":"")+" · Data: "+c.dataFiles.map(function(d){return"<code>"+esc(d)+"</code>"}).join(" ")+"</p>";' +
'if(c.failedChunks)h+="<p class=muted>Note: "+c.failedChunks+" data file(s) could not be read.</p>";' +
'h+="<input id=q placeholder=\\"Search "+esc(c.name)+"…\\" value=\\""+esc(q)+"\\">";' +
'var list=c.items.filter(function(i){return !q||JSON.stringify(i.fields).toLowerCase().indexOf(q.toLowerCase())>-1});' +
'h+="<div>"+list.map(function(i){var img=firstImg(i.fields),t=firstText(i.fields,c.columns);' +
'return"<div class=item>"+(img?"<img class=thumb loading=lazy src=\\""+esc(img)+"\\" alt=\\"\\">":"<div class=thumb></div>")+"<div class=item-main><div class=item-title>"+esc(t)+"</div>"+' +
'(i.page?"<div class=muted><a href=\\"../"+esc(i.page)+"/\\" target=_blank>Open page</a> · file <code>"+esc(i.page)+"/index.html</code></div>":"<div class=muted>No page of its own (used in lists or components)</div>")+' +
'"<details><summary>All fields</summary><table>"+c.columns.map(function(col){return"<tr><td>"+esc(col.title)+(col.type?" <span class=muted>("+esc(col.type)+")</span>":"")+"</td><td>"+cell(i.fields[col.title])+"</td></tr>"}).join("")+"</table></details></div></div>"}).join("")+"</div>";' +
'panel.innerHTML=h;var qi=document.getElementById("q");qi.oninput=function(){var p=qi.selectionStart;render();var n=document.getElementById("q");n.focus();n.setSelectionRange(p,p)}}' +
'DATA.forEach(function(c,i){var b=document.createElement("button");b.className="tab";b.setAttribute("role","tab");b.textContent=c.name+" ("+c.count+")";b.onclick=function(){cur=i;sel();render()};tabs.appendChild(b)});' +
'function sel(){[].forEach.call(tabs.children,function(b,i){b.setAttribute("aria-selected",i===cur)})}sel();render();' +
'</script></body></html>\n';
  }

  // ── Admin manifest (admin/fx-site.json) ────────────────────────────────────
  // Everything the /admin CMS editor needs to find and rewrite CMS data:
  // collections, field schema, data/module files, and which page shows which item.
  function buildAdminManifest(opts) {
    // opts: { collections (parseCollections), chunkBytes, pages: [{path, html}], siteName, sourceUrl, liveUrl, imageMap }
    var itemToCollection = {};
    var collections = opts.collections.map(function (col) {
      var ids = [];
      col.chunks.forEach(function (c) {
        var bytes = opts.chunkBytes[c.file];
        if (!bytes || c.locale !== 'default') return;
        try { decodeChunk(bytes).forEach(function (it) { if (it.id && it.id.v) ids.push(it.id.v); }); } catch (e) {}
      });
      ids.forEach(function (id) { itemToCollection[id] = col.moduleId; });
      var fieldList = Object.keys(col.fields).map(function (id) {
        var f = col.fields[id], out = { id: id, title: f.title, type: f.type };
        if (f.ref) out.ref = f.ref;
        return out;
      });
      var titleField = fieldList.find(function (f) { return /^(title|name)$/i.test(f.title) && f.type === 'String'; }) ||
        fieldList.find(function (f) { return f.type === 'String' && !/^slug$/i.test(f.title); });
      var slugField = fieldList.find(function (f) { return /^slug$/i.test(f.title); });
      return {
        id: col.moduleId, name: col.name, modulePath: col.modulePath,
        chunks: col.chunks.map(function (c) { return { file: 'assets/cms/' + c.file, locale: c.locale }; }),
        fields: fieldList,
        titleFieldId: titleField ? titleField.id : null,
        slugFieldId: slugField ? slugField.id : null,
        itemPages: {}, pagePrefix: null, templatePage: null,
      };
    });
    var byId = {};
    collections.forEach(function (c) { byId[c.id] = c; });

    // Item pages carry data-framer-hydrate-v2 = {routeId, pathVariables, collectionItemId}
    (opts.pages || []).forEach(function (pg) {
      var m = /<div id="main"[^>]*?data-framer-hydrate-v2="([^"]*)"/.exec(pg.html || '');
      if (!m) return;
      try {
        var d = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        var cid = d.collectionItemId && itemToCollection[d.collectionItemId];
        if (!cid || !byId[cid]) return;
        // A collection can have several page templates (e.g. /blog/:slug and
        // /blog/:slug/amp). The shortest path is the item's main page; the rest
        // are kept as extra pages so deletes/renames handle them too.
        var c = byId[cid], id = d.collectionItemId, cur = c.itemPages[id];
        c.extraPages = c.extraPages || {};
        if (!cur) c.itemPages[id] = pg.path;
        else if (pg.path.split('/').length < cur.split('/').length) {
          (c.extraPages[id] = c.extraPages[id] || []).push(cur);
          c.itemPages[id] = pg.path;
        } else (c.extraPages[id] = c.extraPages[id] || []).push(pg.path);
      } catch (e) {}
    });
    collections.forEach(function (c) {
      var paths = Object.keys(c.itemPages).map(function (k) { return c.itemPages[k]; });
      if (!paths.length) return;
      var counts = {};
      paths.forEach(function (p) { var dir = p.split('/').slice(0, -1).join('/'); counts[dir] = (counts[dir] || 0) + 1; });
      c.pagePrefix = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || null;
      c.templatePage = paths.find(function (p) { return p.split('/').slice(0, -1).join('/') === c.pagePrefix; }) || paths[0];
    });

    return {
      version: 1,
      siteName: opts.siteName || '',
      sourceUrl: opts.sourceUrl || '',
      liveUrl: opts.liveUrl || '',
      exportedAt: new Date().toISOString(),
      pages: (opts.pages || []).map(function (p) { return p.path; }),
      imageMap: opts.imageMap || {},
      collections: collections,
    };
  }

  return { decodeChunk: decodeChunk, parseCollections: parseCollections, buildExport: buildExport, buildAdminManifest: buildAdminManifest };
})();

if (typeof module !== 'undefined') module.exports = FXCms;
