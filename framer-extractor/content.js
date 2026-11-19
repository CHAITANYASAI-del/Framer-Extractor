// content.js — Deep page scanner
// Runs AFTER JS has fully executed — captures real rendered DOM state
// Scans: images, fonts, videos (currentSrc), cursors, scripts, inline CSS/JS

(function () {
  'use strict';

  // ── Utilities ─────────────────────────────────────────────────────────────
  function abs(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
    try { return new URL(url, location.href).href; } catch { return null; }
  }

  function slugify(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'asset';
  }

  function fileExt(url) {
    const last = url.split('?')[0].split('#')[0].split('/').pop() || '';
    return last.includes('.') ? last.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  }

  function sectionLabel(el) {
    // Walk up DOM tree to find the nearest heading or named section
    let node = el?.parentElement;
    for (let i = 0; i < 10 && node; i++) {
      const h = node.querySelector(':scope > h1,:scope > h2,:scope > h3, h1, h2, h3');
      if (h?.textContent?.trim()) return h.textContent.trim().slice(0, 40);
      const name = node.dataset?.framerName;
      if (name) return name;
      node = node.parentElement;
    }
    return null;
  }

  // ── Collect ALL framerusercontent.com URLs from rendered HTML ─────────────
  function collectAllFramerUrls() {
    const src = document.documentElement.innerHTML;
    const re  = /https:\/\/framerusercontent\.com\/[^\s"'<>\)\]]+/g;
    return [...new Set((src.match(re) || []).map(u => u.replace(/["'\)\]\s>]+$/, '').replace(/\\n.*$/, '')))];
  }

  // ── Images ────────────────────────────────────────────────────────────────
  function scanImages() {
    const results = [];
    const seen    = new Set();
    let   idx     = 0;

    function add(url, el) {
      const u = abs(url);
      if (!u || seen.has(u)) return;
      seen.add(u);
      const label   = el?.alt?.trim() || el?.title?.trim() || null;
      const section = sectionLabel(el);
      const ext     = fileExt(u) || 'img';
      let   name;
      if (label)   name = `${slugify(label)}.${ext}`;
      else if (section) name = `${slugify(section)}-${idx + 1}.${ext}`;
      else          name = `image-${idx + 1}.${ext}`;
      idx++;
      results.push({ url: u, type: 'image', name });
    }

    // <img>
    document.querySelectorAll('img').forEach(img => {
      add(img.currentSrc || img.src, img);
      img.srcset?.split(',').forEach(p => add(p.trim().split(/\s+/)[0], img));
      if (img.dataset.src) add(img.dataset.src, img);
    });

    // <picture source>
    document.querySelectorAll('picture source').forEach(src => {
      src.srcset?.split(',').forEach(p => add(p.trim().split(/\s+/)[0], src));
    });

    // Inline style background-image
    document.querySelectorAll('[style*="url("]').forEach(el => {
      const m = (el.getAttribute('style') || '').match(/url\(["']?([^"'\)]+)["']?\)/g) || [];
      m.forEach(match => {
        const u = match.replace(/url\(["']?/, '').replace(/["']?\)$/, '');
        if (u.match(/\.(png|jpe?g|webp|avif|gif|svg)/i)) add(u, el);
      });
    });

    return results;
  }

  // ── Videos ───────────────────────────────────────────────────────────────
  function scanVideos() {
    const results = [];
    const seen    = new Set();
    let   idx     = 0;

    function add(url, el) {
      const u = abs(url);
      if (!u || seen.has(u)) return;
      seen.add(u);
      const section = sectionLabel(el);
      const ext     = fileExt(u) || 'mp4';
      const name    = section ? `${slugify(section)}-video-${idx + 1}.${ext}` : `video-${idx + 1}.${ext}`;
      idx++;
      results.push({ url: u, type: 'video', name });
    }

    document.querySelectorAll('video').forEach(vid => {
      // currentSrc reflects what JS actually loaded (most accurate)
      if (vid.currentSrc) add(vid.currentSrc, vid);
      else if (vid.src)   add(vid.src, vid);
      if (vid.poster)     {
        const u = abs(vid.poster);
        if (u) results.push({ url: u, type: 'image', name: `video-poster-${idx++}.jpg` });
      }
      vid.querySelectorAll('source').forEach(s => {
        if (s.src) add(s.src, vid);
      });
      // data-src lazy loads
      if (vid.dataset.src) add(vid.dataset.src, vid);
    });

    // All mp4/webm/ogg from framerusercontent
    collectAllFramerUrls().forEach(u => {
      if (u.match(/\.(mp4|webm|ogg|mov|m4v)($|\?)/i)) add(u, document.body);
    });

    // Also catch ALL video URLs from ANY domain in HTML (cloudinary, vercel, etc.)
    const allHtml = document.documentElement.innerHTML;
    const vidRe = /https?:\/\/[^\s"'<>)]+\.(mp4|webm|ogg|mov)(?:\?[^\s"'<>)]*)*/gi;
    let vm;
    while ((vm = vidRe.exec(allHtml)) !== null) {
      const u = vm[0].replace(/["'\)\s>]+$/, '');
      add(u, document.body);
    }

    return results;
  }

  // ── Fonts ─────────────────────────────────────────────────────────────────
  function scanFonts() {
    const results = [];
    const seen    = new Set();

    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
          const family = rule.style.fontFamily?.replace(/['"]/g, '').trim() || 'font';
          const weight = rule.style.fontWeight || '400';
          const style  = rule.style.fontStyle  || 'normal';
          const src    = rule.style.src || '';

          const re = /url\(["']?([^"'\)]+)["']?\)/g;
          let m;
          while ((m = re.exec(src)) !== null) {
            const u = abs(m[1]);
            if (!u || seen.has(u)) continue;
            seen.add(u);
            const ext  = fileExt(u) || 'woff2';
            const wMap = { '100':'thin','200':'extralight','300':'light','400':'regular','500':'medium','600':'semibold','700':'bold','800':'extrabold','900':'black' };
            const wLabel = wMap[weight] || `w${weight}`;
            const iLabel = style === 'italic' ? '-italic' : '';
            const name = `${slugify(family)}-${wLabel}${iLabel}.${ext}`;
            results.push({ url: u, type: 'font', name });
          }
        }
      } catch {}
    }

    return results;
  }

  // ── Cursors ───────────────────────────────────────────────────────────────
  function scanCursors() {
    const results = [];
    const seen    = new Set();
    let   idx     = 0;

    function add(url, label) {
      const u = abs(url);
      if (!u || seen.has(u)) return;
      seen.add(u);
      const ext  = fileExt(u) || 'png';
      const name = `cursor${idx > 0 ? '-' + (idx + 1) : ''}.${ext}`;
      idx++;
      results.push({ url: u, type: 'cursor', name });
    }

    // CSS cursor: url(...)
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          const txt = rule.cssText || '';
          if (!txt.includes('cursor') || !txt.includes('url(')) continue;
          const re = /cursor:\s*url\(["']?([^"'\)]+)["']?\)/gi;
          let m;
          while ((m = re.exec(txt)) !== null) add(m[1], 'cursor');
        }
      } catch {}
    }

    // Inline style cursor: url(...)
    document.querySelectorAll('[style*="cursor"][style*="url"]').forEach(el => {
      const re = /cursor:\s*url\(["']?([^"'\)]+)["']?\)/gi;
      let m;
      while ((m = re.exec(el.getAttribute('style') || '')) !== null) add(m[1], 'cursor');
    });

    // DOM-based cursor elements (Framer custom cursor divs with images inside)
    const cursorSels = ['[class*="cursor"]', '[id*="cursor"]', '[data-framer-cursor]', '[data-cursor]'];
    cursorSels.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.querySelectorAll('img').forEach(img => { if (img.src) add(img.src, 'cursor'); });
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
          const re = /url\(["']?([^"'\)]+)["']?\)/g;
          let m;
          while ((m = re.exec(bg)) !== null) add(m[1], 'cursor');
        }
      });
    });

    // framerusercontent cursor refs anywhere in HTML
    const allText = document.documentElement.innerHTML;
    const curRe   = /https:\/\/framerusercontent\.com\/[^\s"'<>)]*(?:cursor|pointer)[^\s"'<>)]*\.(png|svg|gif|webp)/gi;
    let m;
    while ((m = curRe.exec(allText)) !== null) add(m[0].replace(/["'\)\s>]+$/, ''), 'cursor');

    return results;
  }

  // ── Scripts ───────────────────────────────────────────────────────────────
  function scanScripts() {
    const results = [];
    const seen    = new Set();
    let   idx     = 0;

    document.querySelectorAll('script[src]').forEach(s => {
      const u = abs(s.src);
      if (!u || seen.has(u)) return;
      // Strip tracking
      if (/events\.framer\.com|googletagmanager|google-analytics|hotjar|segment/.test(u)) return;
      seen.add(u);
      const ext  = fileExt(u.split('?')[0]) || 'js';
      const path = new URL(u).pathname.split('/').pop().split('?')[0];
      // ALWAYS preserve original filename for .mjs files — ES module imports
      // use relative paths that must match the filename on disk.
      // e.g. import("./rolldown-runtime.D3cOTcPh.mjs") must find that exact file.
      let name = path || `script-${idx + 1}.${ext}`;
      idx++;
      results.push({ url: u, type: 'script', name });
    });

    return results;
  }

  // ── Inline CSS & JS ───────────────────────────────────────────────────────
  function collectInline() {
    const css = [];
    document.querySelectorAll('style').forEach(el => {
      if (el.textContent.trim()) css.push(el.textContent);
    });

    const js = [];
    document.querySelectorAll('script:not([src])').forEach(el => {
      const t = el.textContent.trim();
      if (t.length > 10) js.push(t);
    });

    return { css, js };
  }

  // ── Deduplicate runtime-created DOM elements ────────────────────────────
  // Framer's SSR HTML includes cursor/overlay elements, and the JS runtime
  // creates identical ones at hydration. When we capture outerHTML from the
  // LIVE DOM we get both copies. This removes duplicates before serializing.
  // Generic: works on ANY Framer site by looking for sibling elements under
  // #main with identical class lists (a reliable signal of SSR + JS dupes).
  function deduplicateRuntimeElements() {
    const main = document.getElementById('main');
    if (!main) return;

    const classGroups = {};
    Array.from(main.children).forEach(child => {
      if (!child.className || typeof child.className !== 'string') return;
      // Only target pointer-events-none overlays (cursors, decorative layers)
      if (!child.className.includes('framer-pointer-events-none')) return;
      const key = child.className.trim();
      if (!classGroups[key]) classGroups[key] = [];
      classGroups[key].push(child);
    });

    // For each group of identical siblings, keep the LAST one (JS-created,
    // positioned correctly at -20,-20) and remove earlier SSR copies
    let removed = 0;
    Object.values(classGroups).forEach(group => {
      if (group.length > 1) {
        for (let i = 0; i < group.length - 1; i++) {
          group[i].remove();
          removed++;
        }
      }
    });
    return removed;
  }

  // ── Full page scan ────────────────────────────────────────────────────────
  function scanPage() {
    // Clean up SSR/JS duplicate elements before capturing HTML
    deduplicateRuntimeElements();

    const images  = scanImages();
    const videos  = scanVideos();
    const fonts   = scanFonts();
    const cursors = scanCursors();
    const scripts = scanScripts();
    const inline  = collectInline();
    const allUrls = collectAllFramerUrls();

    // Any framerusercontent URL not yet categorised → mark as 'other' for download
    const knownUrls = new Set([
      ...images.map(a=>a.url), ...videos.map(a=>a.url),
      ...fonts.map(a=>a.url),  ...cursors.map(a=>a.url),
      ...scripts.map(a=>a.url),
    ]);
    const uncategorised = allUrls
      .filter(u => !knownUrls.has(u))
      .filter(u => !u.endsWith('.json') && !u.split('?')[0].endsWith('/'))
      .map((u, i) => {
        const ext = fileExt(u) || 'bin';
        // Smart-type by extension so .mjs bundles get fetched as TEXT + URLs rewritten inside
        const type = /^(mjs|js)$/i.test(ext)                      ? 'script'
                   : /^(mp4|webm|ogg|mov|m4v)$/i.test(ext)        ? 'video'
                   : /^(woff2?|ttf|otf|eot)$/i.test(ext)          ? 'font'
                   : /^(png|jpe?g|gif|webp|avif|svg)$/i.test(ext) ? 'image'
                   : /^(css)$/i.test(ext)                          ? 'style'
                   : 'other';
        // For scripts, preserve original filename (critical for ES module import paths!)
        // e.g. "./rolldown-runtime.D3cOTcPh.mjs" must match the file on disk
        const urlPath = new URL(u).pathname.split('/').pop().split('?')[0];
        const name = type === 'script' ? (urlPath || `framer-module-${i + 1}.${ext}`)
                   : type === 'video'  ? `video-extra-${i + 1}.${ext}`
                   : type === 'image'  ? `image-extra-${i + 1}.${ext}`
                   : `asset-${i + 1}.${ext}`;
        return { url: u, type, name };
      });

    return {
      html:      document.documentElement.outerHTML,
      pageTitle: document.title,
      pageUrl:   location.href,
      isFramer:  detectFramer(),
      inline,
      assets: { images, videos, fonts, cursors, scripts, uncategorised },
      counts: {
        images:   images.length,
        videos:   videos.length,
        fonts:    fonts.length,
        cursors:  cursors.length,
        scripts:  scripts.length,
        other:    uncategorised.length,
        inlineCSS: inline.css.length,
        inlineJS:  inline.js.length,
      },
    };
  }

  function detectFramer() {
    return !!(
      document.documentElement.innerHTML.includes('framerusercontent.com') ||
      document.querySelector('meta[name="generator"][content*="Framer"]') ||
      document.querySelector('script[src*="framerusercontent.com"]')
    );
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === 'SCAN_PAGE') {
      try {
        // Small delay to ensure all JS-rendered content is settled
        setTimeout(() => {
          try { sendResponse({ success: true, data: scanPage() }); }
          catch (e) { sendResponse({ success: false, error: e.message }); }
        }, 800);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }
    if (msg.type === 'CHECK_FRAMER') {
      sendResponse({ isFramer: detectFramer(), url: location.href });
      return true;
    }
  });

})();
