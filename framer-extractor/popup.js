// popup.js — Full extraction orchestrator v2.0
// KEY FIXES in v2.0:
//  1. Inline scripts KEPT in HTML (not extracted) — preserves Framer React hydration
//  2. ES module filenames preserved — import paths resolve correctly
//  3. JS bundle paths use relative URLs (../images/, ./chunk.mjs)
//  4. &amp; HTML entity encoding handled in URL rewriting
//  5. Videos from ANY domain (cloudinary, vercel) captured from JS bundles
//  6. file:// detection banner guides users to use local server
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let currentTab   = null;
let extractedZip = null;
let isRunning    = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const siteBadge     = document.getElementById('site-badge');
const siteUrlEl     = document.getElementById('site-url');
const notFramerEl   = document.getElementById('not-framer-warning');
const extractBtn    = document.getElementById('extract-btn');
const downloadBtn   = document.getElementById('download-btn');
const progressWrap  = document.getElementById('progress-container');
const progressFill  = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const progressPct   = document.getElementById('progress-pct');
const logWrap       = document.getElementById('log-container');
const logEl         = document.getElementById('log');

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab  = tab;
  const url   = tab.url || '';

  siteUrlEl.textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '') || '—';

  // Detect Framer sites — first check URL, then check page content
  const isFramerUrl = /\.framer\.(website|site|app|ai|media|photos|wiki)(\/|$)/.test(url);
  if (isFramerUrl) {
    setBadge('framer', 'Framer Site');
    notFramerEl.style.display = 'none';
    extractBtn.disabled       = false;
  } else {
    // For custom domains, inject content script and ask it to detect Framer
    setBadge('unknown', 'Checking…');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, files: ['content.js']
      }).catch(() => {});
      const check = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: 'CHECK_FRAMER' }, (r) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });
      if (check?.isFramer) {
        setBadge('framer', 'Framer Site');
        notFramerEl.style.display = 'none';
        extractBtn.disabled       = false;
      } else {
        // Redirect to not-framer page
        window.location.href = 'not-framer.html';
        return;
      }
    } catch {
      // Redirect to not-framer page
      window.location.href = 'not-framer.html';
      return;
    }
  }

  extractBtn.addEventListener('click',  startExtraction);
  downloadBtn.addEventListener('click', triggerDownload);
});

// ── UI helpers ─────────────────────────────────────────────────────────────
function setBadge(type, label) {
  siteBadge.className = `badge badge--${type}`;
  siteBadge.querySelector('.badge-label').textContent = label;
}
function setStep(id, state) {
  const el = document.getElementById(`step-${id}`);
  if (!el) return;
  el.className = `step step--${state}`;
  const indicator = el.querySelector('.step__indicator');
  if (state === 'done') {
    // Replace dot with checkbox SVG
    indicator.innerHTML = `<img class="step__checkbox" src="assets/Checkbox.svg" alt="" />`;
  } else {
    // Restore dot if it was replaced
    if (!indicator.querySelector('.step__dot')) {
      indicator.innerHTML = `<div class="step__dot step__dot--idle"></div>`;
    }
    indicator.querySelector('.step__dot').className = `step__dot step__dot--${
      state === 'active' ? 'active' : state === 'error' ? 'error' : 'idle'}`;
  }
}
// Extra step shown only when the site uses Framer CMS (same look as the others)
function showCmsStep(desc) {
  let el = document.getElementById('step-cms');
  if (!el) {
    el = document.createElement('div');
    el.className = 'step';
    el.id = 'step-cms';
    el.innerHTML = `
      <div class="step__indicator"><div class="step__dot step__dot--idle"></div></div>
      <div class="step__content">
        <p class="step__title">CMS</p>
        <p class="step__desc" id="step-cms-desc"></p>
      </div>
      <div class="step__count" id="step-cms-count">&mdash;</div>`;
    const zipStep = document.getElementById('step-zip');
    zipStep?.parentNode.insertBefore(el, zipStep);
  }
  const d = document.getElementById('step-cms-desc');
  if (d && desc) d.textContent = desc;
  return el;
}
function hideCmsStep() { document.getElementById('step-cms')?.remove(); }

function setStepCount(id, text) {
  const el = document.getElementById(`step-${id}-count`);
  if (el) el.textContent = text;
}
function setProgress(pct, label) {
  progressFill.style.width  = `${pct}%`;
  progressLabel.textContent = label;
  progressPct.textContent   = `${Math.round(pct)}%`;
}
function addLog(type, msg) {
  const icons = { info:'›', ok:'✓', warn:'!', error:'✗' };
  const line  = document.createElement('div');
  line.className = `log-line log-line--${type}`;
  line.innerHTML = `<span class="log-icon">${icons[type]||'›'}</span><span class="log-msg">${esc(msg)}</span>`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function setLoading(on) {
  const btnOuter = extractBtn.closest('.btn-outer');
  if (on) {
    extractBtn.disabled  = true;
    extractBtn.innerHTML = `<svg class="btn-loading-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.22 4.22l2.83 2.83M12.95 12.95l2.83 2.83M4.22 15.78l2.83-2.83M12.95 7.05l2.83-2.83" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg><span>Extracting…</span>`;
    if (btnOuter) btnOuter.classList.add('btn-outer--extracting');
  } else {
    extractBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M7.5 2v8M4.5 7l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 12h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg><span>Extract Again</span>`;
    extractBtn.disabled = false;
    if (btnOuter) btnOuter.classList.remove('btn-outer--extracting');
  }
}

// ── Main extraction ────────────────────────────────────────────────────────
async function startExtraction() {
  if (isRunning) return;
  isRunning = true;

  progressWrap.style.display = 'flex';
  logWrap.style.display      = 'block';
  downloadBtn.style.display  = 'none';
  document.querySelector('.success-banner')?.remove();
  setLoading(true);
  setProgress(0, 'Starting…');

  try {

    // ── STEP 1: Scan rendered page ─────────────────────────────────────────
    setStep('scan', 'active');
    addLog('info', 'Scanning rendered page (waiting for JS to settle)…');

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id }, files: ['content.js']
    }).catch(() => {});

    const scanRes = await sendMsg({ type: 'SCAN_PAGE' });
    if (!scanRes?.success) throw new Error('Scan failed: ' + (scanRes?.error || 'no response'));

    let { html, pageTitle, pageUrl, assets, inline, counts } = scanRes.data;
    // Save Framer's own server HTML, not the live DOM: the live DOM is the page
    // AFTER entrance animations ran (opacity/transform end states baked in), so
    // it flashes its final state before Framer hides and replays them. The
    // rendered scan is still used to find files that only load later.
    const srvStart = await fetchPageFromServer(pageUrl).catch(() => null);
    if (srvStart?.html && /id="main"/.test(srvStart.html)) {
      html = srvStart.html;
      inline = srvStart.inline;
      mergeAssets(assets, srvStart.assets);
    }
    const total = Object.values(counts).reduce((a,b) => a+b, 0);

    setStep('scan', 'done');
    setStepCount('scan', `${total} items`);
    addLog('ok', `${counts.images} images · ${counts.videos} videos · ${counts.fonts} fonts · ${counts.cursors} cursors · ${counts.scripts} scripts`);
    setProgress(12, 'Downloading…');

    // ── Multi-page: find and extract all internal pages ────────────────────
    const allPagesData = [{ html, pageTitle, pageUrl, inline }];
    // Pages come from (1) links on the page, (2) the site's sitemap.xml — which
    // lists every CMS item page (/work/noir …) — and (3) links found on every
    // page we extract (CMS list pages link to their items).
    // Static pages linked from the start page are captured from a real tab
    // (rendered DOM, up to RENDER_LIMIT). Everything else — mostly CMS items,
    // which can be dozens — is fetched as Framer's server-rendered HTML:
    // faster, no tab flicker, and exactly what Framer itself hydrates.
    const MAX_PAGES    = 150;
    const RENDER_LIMIT = 12;
    const queue = await discoverPages(html, pageUrl);
    const queued = new Set(queue.map(q => pathKey(q.url)));
    queued.add(pathKey(pageUrl));
    if (queue.length > 0) {
      // Show what was found, grouped by section (CMS collections appear as
      // "/work/*" style groups) so users can see everything that will be exported.
      const groups = {};
      queue.forEach(q => {
        const seg = new URL(q.url).pathname.split('/').filter(Boolean);
        const key = seg.length > 1 ? `/${seg[0]}/*` : '/ (pages)';
        groups[key] = (groups[key] || 0) + 1;
      });
      addLog('info', `Found ${queue.length} more page(s): ` +
        Object.entries(groups).map(([k, n]) => `${k} ×${n}`).join(' · '));
      let rendered = 0, qi = 0, skipped = 0;
      const PAGE_BATCH = 6;
      const addPage = (pgUrl, pd) => {
        allPagesData.push({ html: pd.html, pageTitle: pd.pageTitle, pageUrl: pgUrl, inline: pd.inline });
        ['images','videos','fonts','cursors','scripts','uncategorised'].forEach(k => {
          assets[k].push(...(pd.assets[k] || []));
        });
        // Newly found links (e.g. CMS items linked from a list page)
        extractInternalPageUrls(pd.html, pgUrl).forEach(u => {
          const key = pathKey(u);
          if (!queued.has(key)) { queued.add(key); queue.push({ url: u, viaLink: false }); }
        });
      };
      while (qi < queue.length && qi < MAX_PAGES) {
        const item = queue[qi];
        if (item.viaLink && rendered < RENDER_LIMIT) {
          // Static page linked from the start page → capture from a real tab
          qi++; rendered++;
          const pgPath = new URL(item.url).pathname;
          try {
            const [pgResult, srv] = await Promise.all([
              extractPageInBackground(item.url).catch(() => null),
              fetchPageFromServer(item.url).catch(() => null),
            ]);
            // Server HTML for the page itself; the rendered tab adds late-loading files
            let pd = srv && /id="main"/.test(srv.html) ? srv : (pgResult?.success ? pgResult.data : srv);
            if (pd && pgResult?.success && pd !== pgResult.data) mergeAssets(pd.assets, pgResult.data.assets);
            if (pd) { addPage(item.url, pd); addLog('ok', `↳ ${pgPath}`); }
            else { skipped++; addLog('warn', `↳ ${pgPath} skipped (could not load)`); }
          } catch (e) { skipped++; addLog('warn', `Page ${pgPath} skipped: ${e.message}`); }
        } else {
          // CMS items and the rest → fetch server-rendered HTML, several at once
          const batch = [];
          while (qi < queue.length && qi < MAX_PAGES && batch.length < PAGE_BATCH &&
                 !(queue[qi].viaLink && rendered < RENDER_LIMIT)) batch.push(queue[qi++]);
          const results = await Promise.all(batch.map(b => fetchPageFromServer(b.url).catch(() => null)));
          results.forEach((pd, i) => {
            const pgPath = new URL(batch[i].url).pathname;
            if (pd) { addPage(batch[i].url, pd); addLog('ok', `↳ ${pgPath}`); }
            else { skipped++; addLog('warn', `↳ ${pgPath} skipped (could not load)`); }
          });
        }
        setProgress(12, `Pages ${allPagesData.length}/${Math.min(queue.length + 1, MAX_PAGES + 1)}…`);
      }
      if (queue.length > MAX_PAGES) addLog('warn', `Site has ${queue.length + 1} pages — exported the first ${MAX_PAGES + 1}`);
      addLog('ok', `${allPagesData.length} page(s) captured${skipped ? ` · ${skipped} skipped` : ''}`);
    }

    // The 404 page: fetched now so its images are downloaded with everything else
    const notFoundPage = await fetchPageFromServer(new URL('/404', pageUrl).href, true).catch(() => null);
    if (notFoundPage?.html) mergeAssets(assets, notFoundPage.assets);

    // ── STEP 2: Fetch assets ───────────────────────────────────────────────
    setStep('fetch', 'active');

    // Deduplicate across all asset categories
    const allAssets = dedup([
      ...assets.scripts,       // fetched as TEXT
      ...assets.images,
      ...assets.fonts,
      ...assets.videos,
      ...assets.cursors,
      ...assets.uncategorised,
    ]);

    // Resolve filename collisions
    resolveCollisions(allAssets);

    // Map: url → { name, type, localPath, bytes?, text? }
    const fetched = {};
    let done = 0, failed = 0;
    const BATCH = 8;  // CMS data files
    const POOL  = 12; // parallel downloads; a slow file only holds one slot

    await downloadPool(allAssets, POOL, res => {
      done++;
      setProgress(12 + (done / allAssets.length) * 52, `Fetching ${done}/${allAssets.length}…`);
      if (res.success) {
        fetched[res.asset.url] = {
          name: res.asset.name, type: res.asset.type, localPath: localPath(res.asset),
          bytes: res.bytes || null, text: res.text || null,
        };
      } else {
        failed++;
        addLog('warn', `Skipped (${res.error || 'failed'}): ${shortUrl(res.asset.url)}`);
      }
    });

    // ── Round 2: Scan JS bundle text for MORE asset URLs ──────────────────
    addLog('info', 'Scanning JS bundles for embedded asset URLs…');
    const extraAssets = [];
    const knownUrls   = new Set(Object.keys(fetched));

    Object.entries(fetched).filter(([_, f]) => f.type === 'script' && f.text).forEach(([originalScriptUrl, f]) => {
      // 2a. Scan for framerusercontent.com URLs (absolute)
      const fuRe = /https:\/\/framerusercontent\.com\/[^\s"'`<>\)\]\\]+/g;
      let m;
      while ((m = fuRe.exec(f.text)) !== null) {
        const u = m[0].replace(/["'`\)\]\s>\\]+$/, '');
        // Skip folder-style URLs (e.g. ".../third-party-assets/fontshare/") — not files
        if (!knownUrls.has(u) && !u.endsWith('.json') && !u.split('?')[0].endsWith('/')) {
          knownUrls.add(u);
          const lastSeg = u.split('?')[0].split('#')[0].split('/').pop() || '';
          const ext  = (lastSeg.includes('.') ? lastSeg.split('.').pop() : 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
          const type = ext.match(/mp4|webm|ogg|mov/) ? 'video'
                     : ext.match(/woff2?|ttf|otf/)   ? 'font'
                     : ext.match(/mjs|js/)            ? 'script'
                     : ext.match(/png|jpe?g|gif|webp|avif|svg/) ? 'image'
                     : ext.match(/css/)               ? 'style'
                     : 'other';
          const idx  = extraAssets.length;
          let eName;
          if (type === 'script') {
            try { eName = new URL(u).pathname.split('/').pop().split('?')[0] || `script-bundle-${idx+1}.${ext}`; }
            catch { eName = `script-bundle-${idx+1}.${ext}`; }
          } else {
            eName = `${type}-bundle-${idx+1}.${ext}`;
          }
          extraAssets.push({ url: u, type, name: eName });
        }
      }

      // 2b. Also scan for video URLs from ANY domain (cloudinary, vercel, etc.)
      const vidRe = /https?:\/\/[^\s"'`<>\)\]\\]+\.(mp4|webm|ogg|mov)(?:\?[^\s"'`<>\)\]\\]*)*/gi;
      let vm;
      while ((vm = vidRe.exec(f.text)) !== null) {
        const u = vm[0].replace(/["'`\)\]\s>\\]+$/, '');
        if (!knownUrls.has(u)) {
          knownUrls.add(u);
          const ext = u.split('?')[0].split('.').pop().toLowerCase() || 'mp4';
          const idx = extraAssets.length;
          extraAssets.push({ url: u, type: 'video', name: `video-bundle-${idx+1}.${ext}` });
        }
      }

      // 2c. KEY FIX: Scan for relative imports (./chunk.mjs) — Framer code-split chunks
      //     These are lazy-loaded routes/components that our HTML scan misses.
      //     Resolve them against the original script URL to get the full download URL.
      const relRe = /(?:from\s*|import\s*\(?\s*)[`'"](\.\.?\/[^`'"]+\.m?js)[`'"]/g;
      let rm;
      while ((rm = relRe.exec(f.text)) !== null) {
        try {
          const resolvedUrl = new URL(rm[1], originalScriptUrl).href;
          if (!knownUrls.has(resolvedUrl)) {
            knownUrls.add(resolvedUrl);
            const filename = resolvedUrl.split('/').pop().split('?')[0] || `chunk-${extraAssets.length}.mjs`;
            extraAssets.push({ url: resolvedUrl, type: 'script', name: filename });
          }
        } catch {}
      }
    });

    if (extraAssets.length > 0) {
      addLog('info', `Found ${extraAssets.length} more assets inside JS bundles — downloading…`);
      resolveCollisions(extraAssets);

      let extraDone = 0;
      await downloadPool(extraAssets, POOL, res => {
        extraDone++;
        setProgress(64, `Bundled assets ${extraDone}/${extraAssets.length}…`);
        if (res.success) {
          fetched[res.asset.url] = {
            name: res.asset.name, type: res.asset.type, localPath: localPath(res.asset),
            bytes: res.bytes || null, text: res.text || null,
          };
        } else {
          failed++;
          addLog('warn', `Skipped (${res.error || 'failed'}): ${shortUrl(res.asset.url)}`);
        }
      });

      // ── Deeper rounds: chunks import other chunks (route → component →
      //    shared chunk …). Keep following imports until nothing new appears,
      //    otherwise some pages/components fail to load after export.
      let toScan = extraAssets.filter(a => a.type === 'script').map(a => a.url);
      for (let round = 0; round < 6 && toScan.length; round++) {
        const deeper = [];
        const known  = new Set(Object.keys(fetched));
        toScan.forEach(scriptUrl => {
          const f = fetched[scriptUrl];
          if (!f || f.type !== 'script' || !f.text) return;
          const relRe2 = /(?:from\s*|import\s*\(?\s*)[`'"](\.\.?\/[^`'"]+\.m?js)[`'"]/g;
          let rm2;
          while ((rm2 = relRe2.exec(f.text)) !== null) {
            try {
              const resolvedUrl = new URL(rm2[1], scriptUrl).href;
              if (!known.has(resolvedUrl)) {
                known.add(resolvedUrl);
                const filename = resolvedUrl.split('/').pop().split('?')[0] || `chunk-r${round}-${deeper.length}.mjs`;
                deeper.push({ url: resolvedUrl, type: 'script', name: filename });
              }
            } catch {}
          }
        });
        if (!deeper.length) break;
        addLog('info', `Found ${deeper.length} deeper chunk(s) — downloading…`);
        resolveCollisions(deeper);
        await downloadPool(deeper.map(a => ({ ...a, type: 'script' })), POOL, res => {
          if (res.success) {
            fetched[res.asset.url] = {
              name: res.asset.name, type: 'script', localPath: localPath(res.asset),
              bytes: null, text: res.text || null,
            };
          }
        });
        toScan = deeper.map(a => a.url);
      }
    }

    const totalFetched = Object.keys(fetched).length;
    setStep('fetch', 'done');
    setStepCount('fetch', `${totalFetched} files`);
    addLog('ok', `Downloaded ${totalFetched} assets total${failed ? ` · ${failed} skipped` : ''}`);
    setProgress(68, 'Rewriting & separating…');

    // ── STEP 3: Rewrite + Separate HTML / CSS / JS ─────────────────────────
    setStep('rewrite', 'active');

    // Build URL→localPath map for fast lookup
    const urlMap = {};
    Object.entries(fetched).forEach(([url, f]) => { urlMap[url] = f.localPath; });

    // 3a. Rewrite JS bundle text
    //     TWO kinds of URLs in JS bundles need different treatment:
    //     - import("./chunk.mjs")  → resolved relative to THE SCRIPT's URL ✓
    //     - img.src = "path/img.png" → resolved relative to THE DOCUMENT's URL ✗
    //     So for JS-to-JS imports we need ./ relative paths,
    //     but for images/fonts/videos/cursors we need document-relative paths.
    const jsUrlMap = {};
    Object.entries(urlMap).forEach(([url, lp]) => {
      if (lp.startsWith('assets/js/')) {
        // Only rewrite .mjs ES module files to relative paths.
        // .js CMS/data files (e.g. do6zpM74i.js) are used as BASE URLs in
        // new URL(chunk, baseUrl) calls inside Framer bundles. If we rewrite
        // them to relative paths, new URL(relative, relative) throws "Invalid
        // base URL" → Framer catches it as Fatal error → blank page.
        // Keeping .js files as their original absolute framerusercontent URL
        // means the URL construction works; CMS fetches either succeed from
        // CDN or fail gracefully — neither causes a fatal render crash.
        if (lp.endsWith('.mjs')) {
          jsUrlMap[url] = './' + lp.replace('assets/js/', '');
        }
        // .js files: intentionally excluded — keep original absolute URL in bundles
      } else {
        // Everything else (images, fonts, videos, cursors, CSS):
        // When JS sets img.src/video.src, browser resolves relative to
        // the DOCUMENT base URL, not the script URL.
        // So use document-relative path as-is.
        jsUrlMap[url] = lp;
      }
    });

    Object.values(fetched).filter(f => f.type === 'script' && f.text).forEach(f => {
      f.rewrittenText = rewriteUrls(f.text, jsUrlMap);
    });

    // SEO: Framer's runtime writes <link rel="canonical"> from siteCanonicalURL.
    // On a *.framer.app site that would tell Google the "real" page is still on
    // Framer. Make it use whatever domain the export is deployed to instead.
    const siteForSeo = siteInfo(pageUrl);
    if (siteForSeo.isFramerHost) {
      const esc = siteForSeo.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const canonRe = new RegExp('siteCanonicalURL:\\s*([`\'"])' + esc + '\\/?\\1', 'g');
      const dynamicCanon = "siteCanonicalURL:(location.origin+(window.__FX_ROOT||'/')).replace(/\\/$/,'')";
      Object.values(fetched).forEach(f => {
        if (f.rewrittenText && f.rewrittenText.includes('siteCanonicalURL')) {
          f.rewrittenText = f.rewrittenText.replace(canonRe, () => dynamicCanon);
        }
      });
    }

    // 3b. Process HTML: remove analytics, extract CSS/JS, rewrite ALL URLs
    const { cleanHtml, inlineCSS } = processHtml(html, urlMap, inline, '');
    const finalCSS = inlineCSS;

    setStep('rewrite', 'done');
    setStepCount('rewrite', 'Done');
    addLog('ok', `HTML cleaned · styles.css · JS bundles rewritten`);
    setProgress(80, 'Building ZIP…');

    // ── STEP 4: Build ZIP ──────────────────────────────────────────────────
    setStep('zip', 'active');

    // Everything goes inside one clean top-level folder, so unzipping always
    // gives "<site>-site/" — never a folder ending in ".app" (macOS would show
    // it as a broken application), whatever the ZIP itself gets renamed to.
    const zipRoot = new JSZip();
    const zip = zipRoot.folder(siteFolderName(pageUrl));

    const site = siteInfo(pageUrl);
    const seoNotes = { noindexPages: [], canonicalsRemoved: 0 };

    // index.html — at root
    const writtenHtml = [cleanHtml];
    zip.file('index.html', seoFix(cleanHtml, site, seoNotes, '/'));

    // Sub-pages — each internal page saved as path/index.html
    const exportedPaths = [];
    for (const pg of allPagesData.slice(1)) {
      try {
        const pgPath = decodeURIComponent(new URL(pg.pageUrl).pathname).replace(/^\//, '').replace(/\/$/, '');
        if (pgPath) {
          const { cleanHtml: pgHtml } = processHtml(pg.html, urlMap, pg.inline, pgPath);
          zip.file(`${pgPath}/index.html`, seoFix(pgHtml, site, seoNotes, '/' + pgPath));
          exportedPaths.push(pgPath);
          writtenHtml.push(pgHtml);
        }
      } catch(e) { addLog('warn', `Sub-page skipped: ${e.message}`); }
    }
    addLog('ok', `${exportedPaths.length + 1} page(s) written`);

    // 404 page — Framer's own /404 design, served by Netlify, Vercel,
    // Cloudflare Pages and GitHub Pages automatically for unknown URLs.
    let notFoundHtml = null;
    try {
      const nf = notFoundPage;
      if (nf?.html) {
        const { cleanHtml: nfHtml } = processHtml(nf.html, urlMap, nf.inline, '404');
        notFoundHtml = nfHtml;
        zip.file('404.html', seoFix(nfHtml, site, seoNotes, '/404'));
      }
    } catch {}

    // styles.css — AT ROOT
    if (finalCSS.trim()) {
      zip.file('styles.css', finalCSS);
    }

    // CMS data chunks — download .framercms files for offline CMS support
    const cmsChunks = findCmsChunks(fetched);
    const cmsBytes  = {};
    if (cmsChunks.length > 0) {
      showCmsStep('Collections · items · editor');
      setStep('cms', 'active');
      addLog('info', `Downloading ${cmsChunks.length} CMS data file(s)…`);
      for (let ci = 0; ci < cmsChunks.length; ci += BATCH) {
        const batch = cmsChunks.slice(ci, ci + BATCH);
        await Promise.all(batch.map(async ({ url, name }) => {
          try {
            // .framercms files are BINARY — fetching as text corrupts them and
            // Framer crashes with "Reading out of bounds" (black CMS pages).
            const r = await netFetch({ type: 'FETCH_ASSET', url });
            if (r?.success) {
              zip.file(`assets/cms/${name}`, r.bytes);
              cmsBytes[name] = r.bytes;
            } else addLog('warn', `CMS data skipped: ${name}`);
          } catch {}
        }));
      }
    }

    // Readable CMS: decode collections → cms/data/ (CSV + JSON copies)
    let cmsSummary = [];
    let cmsCollections = [];
    if (Object.keys(cmsBytes).length && typeof FXCms !== 'undefined') {
      try {
        const scriptTexts = Object.values(fetched).filter(f => f.type === 'script' && f.text).map(f => ({ text: f.text, path: f.localPath }));
        cmsCollections    = FXCms.parseCollections(scriptTexts);
        const cmsOut      = FXCms.buildExport(cmsCollections, cmsBytes, exportedPaths, urlMap);
        Object.entries(cmsOut.files).forEach(([p, content]) => zip.file(p, content));
        cmsSummary = cmsOut.collections;
        if (cmsSummary.length) {
          addLog('ok', `CMS: ${cmsSummary.map(c => `${c.name} (${c.count})`).join(' · ')} → /cms`);
        }
      } catch (e) {
        addLog('warn', `CMS content export skipped: ${e.message}`);
      }
    }

    // CMS (/cms): editor with live preview + publish to folder,
    // GitHub or Vercel Blob. Needs a manifest describing collections and pages.
    let adminIncluded = false;
    if (typeof FXCms !== 'undefined') {
      try {
        const pagesForAdmin = [{ path: '', html: cleanHtml },
          ...exportedPaths.map((p, i) => ({ path: p, html: writtenHtml[i + 1] })),
          ...(notFoundHtml ? [{ path: '404', html: notFoundHtml }] : [])];
        const imageMap = {};
        Object.entries(urlMap).forEach(([u, lp]) => {
          if (!lp.startsWith('assets/images/')) return;
          const base = u.split('?')[0];
          if (!imageMap[base]) imageMap[base] = lp;
        });
        const adminManifest = FXCms.buildAdminManifest({
          collections: cmsCollections.filter(c => c.modulePath), chunkBytes: cmsBytes, pages: pagesForAdmin,
          siteName: pageTitle, sourceUrl: pageUrl, liveUrl: site.isFramerHost ? '' : site.origin, imageMap,
        });
        // Every local file each Framer image became (size variants get their own
        // names, e.g. women-1/2/3.jpg) — lets the CMS swap an image on every page
        const imageFiles = {};
        Object.entries(urlMap).forEach(([u, lp]) => {
          if (!lp.startsWith('assets/images/') || !/framerusercontent\.com\/images\//.test(u)) return;
          const id = u.split('?')[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '');
          const name = lp.split('/').pop();
          (imageFiles[id] = imageFiles[id] || []).includes(name) || imageFiles[id].push(name);
        });
        adminManifest.imageFiles = imageFiles;
        // Only sites that use Framer CMS get the editor + its server files
        if (adminManifest.collections.length) {
          zip.file('cms/fx-site.json', JSON.stringify(adminManifest, null, 2));
          adminIncluded = await addAdminFiles(zip, { cmsModules: adminManifest.collections.map(c => c.modulePath.split('/').pop()) });
          if (adminIncluded) addLog('ok', `CMS added → /cms (${adminManifest.collections.length} collection${adminManifest.collections.length === 1 ? '' : 's'})`);
          const totalItems = cmsSummary.reduce((n, c) => n + c.count, 0);
          showCmsStep(`${adminManifest.collections.map(c => c.name).join(' · ')} · editor at /cms`);
          setStep('cms', 'done');
          setStepCount('cms', `${totalItems} items`);
        } else hideCmsStep();
      } catch (e) {
        addLog('warn', `CMS skipped: ${e.message}`);
      }
    }

    // Hosting + SEO files
    hostingFiles(zip, site, exportedPaths, adminIncluded);
    try {
      const ps = await fetch(chrome.runtime.getURL('site-kit/preview-server.mjs'));
      if (ps.ok) zip.file('preview-server.mjs', await ps.text(), { unixPermissions: '755' });
    } catch {}
    // npm start / npm run dev → the included preview server (what people and
    // AI tools try first). No build step; deps only for the CMS on Vercel.
    zip.file('package.json', JSON.stringify({
      name: siteFolderName(pageUrl),
      private: true,
      type: 'module',
      description: 'Static site exported from Framer with Framer Extractor. Run: npm start',
      scripts: { start: 'node preview-server.mjs --open', dev: 'node preview-server.mjs --open', preview: 'node preview-server.mjs --open' },
      // `npx serve` / `npx http-server` in this folder run the site's own server
      // (publish works, both links printed) instead of a generic file server
      bin: { serve: 'preview-server.mjs', 'http-server': 'preview-server.mjs', 'live-server': 'preview-server.mjs' },
      ...(adminIncluded ? { dependencies: { '@vercel/blob': '^2.0.0' } } : {}),
    }, null, 2) + '\n');

    // Independence check — how many Framer CDN URLs are still referenced by pages
    const leftovers = new Set();
    writtenHtml.forEach(h => {
      (h.match(/https:\/\/framerusercontent\.com\/(?:images|assets)\/[^\s"'<>)]+/g) || [])
        .forEach(u => leftovers.add(u.split('?')[0]));
    });
    if (leftovers.size) addLog('warn', `${leftovers.size} image/asset URL(s) still load from Framer's CDN (variants only used at some screen sizes)`);
    else addLog('ok', 'Independence check: every page asset is local');
    if (seoNotes.noindexPages.length) addLog('warn', `${seoNotes.noindexPages.length} page(s) are set to "noindex" in Framer — search engines will skip them`);

    // All downloaded assets
    Object.values(fetched).forEach(f => {
      if (f.type === 'script' && f.rewrittenText != null) {
        zip.file(f.localPath, f.rewrittenText);
      } else if (f.bytes) {
        // Images/videos/fonts are already compressed — storing them is much faster
        zip.file(f.localPath, f.bytes, { compression: 'STORE' });
      } else if (f.text) {
        zip.file(f.localPath, rewriteUrls(f.text, urlMap));
      }
    });

    // README
    zip.file('README.md', readme(pageTitle, pageUrl, totalFetched, {
      pages: exportedPaths.length + 1, cms: cmsSummary, site, seoNotes, leftovers: leftovers.size, admin: adminIncluded,
    }));
    const guide = agentsGuide(pageTitle, pageUrl, { admin: adminIncluded });
    zip.file('AGENTS.md', guide);
    zip.file('CLAUDE.md', guide);

    const blob = await zipRoot.generateAsync({
      type: 'blob', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 6 }
    }, meta => {
      setProgress(80 + (meta.percent / 100) * 17, `Compressing… ${Math.round(meta.percent)}%`);
    });

    extractedZip = blob;
    const mb = (blob.size / 1024 / 1024).toFixed(2);

    setStep('zip', 'done');
    setStepCount('zip', `${mb} MB`);
    addLog('ok', `ZIP ready — ${mb} MB`);
    setProgress(100, 'Complete!');
    showSuccess(pageTitle, blob.size, counts);

  } catch (err) {
    addLog('error', err.message);
    setProgress(0, 'Error — see log');
    console.error('[FramerExtractor]', err);
    setLoading(false);
  } finally {
    isRunning = false;
  }
}

// ── HTML processing ─────────────────────────────────────────────────────────
// RULE: Do NOT strip data attributes or format HTML — Framer's JS runtime
// relies on data-projection-id, data-framer-name, etc. for animations,
// hover-video, and cursor. Stripping them breaks the site.
// RULE: Do NOT reformat HTML — Framer uses React SSR hydration comments
// (<!--$-->) that get destroyed by naive formatters.
function processHtml(htmlString, urlMap, inline, pagePath = '') {

  // 1. Remove analytics & editor scripts (string-level, safe)
  let html = htmlString;
  html = html.replace(/<script[^>]*events\.framer\.com[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script[^>]*framer\.com\/edit\/init[^>]*>[\s\S]*?<\/script>/gi, '');
  // NOTE: the site owner's own analytics (GA4, GTM, Plausible…) are KEPT —
  // they added them in Framer and want them on their self-hosted site too.
  // Only Framer's own tracking/editor scripts are removed.

  // 1c. Strip Framer attributes that cause runtime redirect/editor behaviour
  //     data-redirect-timezone="1" → Framer JS reads this and redirects the page
  //       based on the user's timezone, causing a page jump on extracted sites.
  //     data-jetski-tab-id → Framer editor/collaboration tool marker; harmless
  //       to remove and prevents editor-mode checks from running.
  html = html.replace(/\s*data-redirect-timezone="[^"]*"/g, '');
  html = html.replace(/\s*data-jetski-tab-id="[^"]*"/g, '');

  // 1b. Remove "Made with Framer" badge
  //     Can't use simple regex (nested divs + sibling script tag after it).
  //     Walk the string, count <div> nesting to find the badge container's matching </div>.
  const badgeStart = html.indexOf('<div id="__framer-badge-container"');
  if (badgeStart !== -1) {
    let depth = 0, pos = badgeStart, found = -1;
    while (pos < html.length) {
      const nextOpen  = html.indexOf('<div', pos + 1);
      const nextClose = html.indexOf('</div>', pos + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen;
      } else {
        if (depth === 0) {
          found = nextClose + '</div>'.length;
          break;
        }
        depth--;
        pos = nextClose;
      }
    }
    if (found !== -1) {
      html = html.slice(0, badgeStart) + html.slice(found);
    }
  }

  // 2. Keep every page's own <style> blocks exactly where Framer put them.
  //    (Moving them into one shared file left every page except the home page
  //    without its layout CSS until JavaScript re-added it → a flash of raw,
  //    unstyled content — blue links, stray lines — on every load.)
  //    styles.css is an empty file for the site owner's own overrides; it is
  //    linked LAST in <head>, so rules added there win.
  let inlineCSS = `/* Your custom CSS goes here. This file loads after Framer's own styles,\n   so anything you add here overrides them. (Framer's styles stay inside\n   each page's HTML, exactly as Framer serves them.) */\n`;

  // 3. DO NOT extract inline scripts — Framer's JS runtime depends on
  //    inline scripts in <head> for import maps, React hydration config,
  //    and page data. Moving them breaks the entire site.
  //    We still rewrite URLs inside inline scripts (step 7 handles this).
  let inlineJS = '';

  // 4. Inject <link> for styles.css AND file:// detection helper
  const fileProtocolHelper = `
<script>
if(location.protocol==='file:'){
  document.addEventListener('DOMContentLoaded',function(){
    var d=document.createElement('div');
    d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999999;background:#1E293B;color:#F8FAFC;padding:14px 20px;font:13px/1.5 system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    d.innerHTML='<strong>Animations, CMS and links need a local server.</strong> Double-click <code style=\"background:#334155;padding:2px 8px;border-radius:4px;margin:0 4px\">preview-mac.command</code> or <code style=\"background:#334155;padding:2px 8px;border-radius:4px;margin:0 4px\">preview-windows.bat</code> in this folder, or drag the folder to netlify.com/drop. <button onclick=\"this.parentElement.remove()\" style=\"margin-left:12px;background:#475569;border:none;color:#F8FAFC;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px\">✕</button>';
    document.body.prepend(d);
  });
}
</script>`;
  // Runtime site-root detection. Every page knows its own path inside the ZIP
  // (pagePath, e.g. "work/noir" or "" for home), so it can work out where the
  // site root is no matter where it is hosted: domain root, a subfolder
  // (GitHub Pages project site), with or without trailing slash, or file://.
  // It then sets <base href> so every relative asset path resolves from the root.
  const pagePathJs = JSON.stringify(pagePath || '');
  const rootBase = `<script>(function(){var P=${pagePathJs};var p=location.pathname.replace(/index\\.html$/,'').replace(/\\/+$/,'');var r;if(P&&p.slice(-P.length-1)==='/'+P){r=p.slice(0,p.length-P.length)}else if(P){r='/'}else{r=p+'/'}if(r.charAt(0)!=='/')r='/'+r;window.__FX_ROOT=r;document.write('<base href="'+r+'">');` +
    // Framer's image/lightbox code does new URL(src). Our local image paths
    // are relative ("assets/images/x.jpg"), which new URL() rejects → blank
    // page. Resolve ONLY our own asset paths against the page base; every
    // other URL behaves exactly as before.
    `var U=window.URL,A=/^(\\.{0,2}\\/)*assets\\//;function X(u,b){if(b===undefined&&typeof u==='string'&&A.test(u))return new U(u,document.baseURI);return b===undefined?new U(u):new U(u,b)}X.prototype=U.prototype;Object.setPrototypeOf(X,U);window.URL=X})();</script>`;

  // CMS fetch interceptor — redirects .framercms requests to the local copy in
  // assets/cms/. Handles string, URL and Request inputs, and any hosting root.
  // Framer's CMS loader requests PARTIAL data with "?range=from-to,from-to":
  // Framer's CDN returns only those byte ranges, concatenated. A static host
  // ignores the parameter and returns the whole file, which Framer rejects
  // ("Unexpected response length" → blank page). So this shim reads the local
  // file and slices out exactly the ranges asked for.
  const cmsInterceptor = `<script>(function(){var f=window.fetch;window.fetch=function(u,o){var s=typeof u==='string'?u:(u&&(u.href||u.url))||'';if(s.indexOf('.framercms')>-1){var q=s.split('?');var url=(window.__FX_ROOT||'/')+'assets/cms/'+q[0].split('/').pop();var rg='';if(q[1]){q[1].split('&').forEach(function(kv){if(kv.indexOf('range=')===0)rg=decodeURIComponent(kv.slice(6))})}if(!rg)return f(url,o);return f(url,o).then(function(r){if(!r.ok)return r;return r.arrayBuffer().then(function(b){var ch=[],n=0;rg.split(',').forEach(function(p){var a=p.split('-');var from=Math.min(+a[0],b.byteLength),to=Math.min(+a[1]+1,b.byteLength);var c=new Uint8Array(b,from,Math.max(0,to-from));ch.push(c);n+=c.length});var out=new Uint8Array(n),off=0;ch.forEach(function(c){out.set(c,off);off+=c.length});return new Response(out,{status:200})})})}return f(u,o)};})();</script>`;

  // rootBase must be the FIRST thing in <head> so <base> applies to everything after it
  html = html.replace(/<head([^>]*)>/i, `<head$1>\n${rootBase}\n${cmsInterceptor}${fileProtocolHelper}`);
  // Owner overrides last, after Framer's own <style> blocks
  html = html.replace(/<\/head>/i, `<link rel="stylesheet" href="styles.css">\n</head>`);

  // 5. (Inline scripts kept in HTML — no extraction needed)

  // 6. Ensure DOCTYPE
  if (!/^<!DOCTYPE/i.test(html.trim())) {
    html = '<!DOCTYPE html>\n' + html;
  }

  // 7. Rewrite all asset URLs (this is safe — just string replacement)
  html = rewriteUrls(html, urlMap);

  // 8. Also rewrite URLs inside the extracted CSS
  inlineCSS = rewriteUrls(inlineCSS, urlMap);

  // 9. Inline scripts are in the HTML — their URLs were already rewritten in step 7

  return { cleanHtml: html, inlineCSS, inlineJS };
}

// ── URL rewriting (works on any string: HTML, CSS, JS) ────────────────────
// Handles both raw URLs (& in JS/CSS) and HTML-encoded URLs (&amp; in HTML)
// Single pass: one combined regex (longest URLs first so a URL never matches
// a shorter prefix of itself). Much faster than one regex per URL on sites
// with hundreds of assets and dozens of pages.
const _rewriteCache = new WeakMap();
function rewriteUrls(text, urlMap) {
  if (!text) return text;
  let compiled = _rewriteCache.get(urlMap);
  if (!compiled || compiled.size !== Object.keys(urlMap).length) {
    const lookup = new Map();
    Object.entries(urlMap).forEach(([url, lp]) => {
      lookup.set(url, lp);
      // HTML-encoded variant (&amp;) — critical for srcset/href/src in HTML
      if (url.includes('&')) lookup.set(url.replace(/&/g, '&amp;'), lp);
    });
    const keys = [...lookup.keys()].sort((a, b) => b.length - a.length)
      .map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    compiled = { size: Object.keys(urlMap).length, lookup,
                 re: keys.length ? new RegExp(keys.join('|'), 'g') : null };
    _rewriteCache.set(urlMap, compiled);
  }
  if (!compiled.re) return text;
  return text.replace(compiled.re, m => compiled.lookup.get(m) ?? m);
}

// ── SEO + hosting helpers ───────────────────────────────────────────────────
function siteInfo(pageUrl) {
  const u = new URL(pageUrl);
  // Framer-hosted subdomains — the export will live on a NEW domain, so
  // canonical tags pointing at the Framer subdomain must not be kept.
  const isFramerHost = /\.framer\.(app|website|site|ai|media|photos|wiki)$/i.test(u.hostname) ||
                       /(^|\.)framercanvas\.com$/i.test(u.hostname);
  return { origin: u.origin, host: u.hostname, isFramerHost };
}

function seoFix(html, site, notes, path) {
  let out = html;
  if (/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(out)) notes.noindexPages.push(path);
  if (site.isFramerHost) {
    // Canonical / og:url pointing at the old *.framer.app address would tell
    // Google the real page lives on Framer — remove so the new domain ranks.
    const esc = site.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const before = out.length;
    out = out.replace(new RegExp(`<link[^>]+rel=["']canonical["'][^>]+href=["']${esc}[^"']*["'][^>]*>`, 'gi'), '');
    out = out.replace(new RegExp(`<link[^>]+href=["']${esc}[^"']*["'][^>]+rel=["']canonical["'][^>]*>`, 'gi'), '');
    out = out.replace(new RegExp(`<meta[^>]+property=["']og:url["'][^>]+content=["']${esc}[^"']*["'][^>]*>`, 'gi'), '');
    if (out.length !== before) notes.canonicalsRemoved++;
  }
  return out;
}

function hostingFiles(zip, site, paths, hasCms) {
  const cmsRule = hasCms ? 'Disallow: /cms/\n' : '';
  const all = ['', ...paths];
  // robots.txt + sitemap.xml. On a custom domain we know the final URL, so the
  // sitemap is ready to submit. On *.framer.app we don't — write a template.
  if (!site.isFramerHost) {
    const urls = all.map(p => `  <url><loc>${site.origin}/${encodeURI(p)}</loc></url>`).join('\n');
    zip.file('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    zip.file('robots.txt', `User-agent: *\nAllow: /\n${cmsRule}\nSitemap: ${site.origin}/sitemap.xml\n`);
  } else {
    const urls = all.map(p => `  <url><loc>https://YOUR-DOMAIN.com/${encodeURI(p)}</loc></url>`).join('\n');
    zip.file('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Replace YOUR-DOMAIN.com with your real domain before deploying (see README) -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    zip.file('robots.txt', `User-agent: *\nAllow: /\n${cmsRule}\n# After replacing YOUR-DOMAIN.com in sitemap.xml, add:\n# Sitemap: https://YOUR-DOMAIN.com/sitemap.xml\n`);
  }
  // GitHub Pages: serve files as-is (no Jekyll processing)
  zip.file('.nojekyll', '');
  // One-click local preview (module scripts don't run from file://)
  zip.file('preview-mac.command',
    '#!/bin/bash\n# Double-click to preview this site (and use /cms). Keep the window open; close it to stop.\n' +
    'cd "$(dirname "$0")"\nPORT=8080\n' +
    'if command -v node >/dev/null 2>&1; then\n  node preview-server.mjs $PORT --open\n' +
    'elif xcode-select -p >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then\n  (sleep 1; open "http://localhost:$PORT") &\n  python3 -m http.server $PORT\n' +
    'else\n  osascript -e \'display dialog "To preview your site, install Node.js (free) from nodejs.org, then double-click this file again." buttons {"Open nodejs.org"} default button 1\' && open "https://nodejs.org/en/download"\nfi\n',
    { unixPermissions: '755' });
  zip.file('preview-windows.bat',
    '@echo off\r\nREM Double-click to preview this site (and use /cms). Close this window to stop.\r\n' +
    'cd /d "%~dp0"\r\n' +
    'where node >nul 2>nul && (node preview-server.mjs 8080 --open & goto :eof)\r\n' +
    'where python >nul 2>nul && (start "" http://localhost:8080 & python -m http.server 8080 & goto :eof)\r\n' +
    'echo To preview your site, install Node.js from https://nodejs.org then run this file again.\r\nstart "" https://nodejs.org/en/download\r\npause\r\n');
}

// Copy the prebuilt Site Admin + deploy kit from the extension into the ZIP
const ADMIN_FILES = [
  ['admin-dist/index.html', 'cms/index.html'],
  ['admin-dist/assets/admin.js', 'cms/assets/admin.js'],
  ['admin-dist/assets/admin.css', 'cms/assets/admin.css'],
  ['admin-dist/assets/heic.js', 'cms/assets/heic.js'], // iPhone photo decoder, loaded only when needed
  ['admin-dist/fx-admin-sw.js', 'fx-admin-sw.js'],
  ['site-kit/fx-server/handler.mjs', 'fx-server/handler.mjs'],
  ['site-kit/api/fx-cms.mjs', 'api/fx-cms.mjs'],
  ['site-kit/netlify/functions/fx-cms.mjs', 'netlify/functions/fx-cms.mjs'],
  ['site-kit/middleware.js', 'middleware.js'],
  ['site-kit/netlify.toml', 'netlify.toml'],
];
async function addAdminFiles(zip, { cmsModules = [] } = {}) {
  const loaded = await Promise.all(ADMIN_FILES.map(async ([src, dest]) => {
    const r = await fetch(chrome.runtime.getURL(src));
    if (!r.ok) throw new Error(`missing ${src}`);
    let text = await r.text();
    // Vercel Blob layer: also handle the CMS collection modules (the CMS
    // republishes them) — and no other script, so the rest load at CDN speed
    if (dest === 'middleware.js') {
      const names = cmsModules.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&'));
      text = text.replace('__FX_CMS_JS__', names.length ? `|js/(?:${names.join('|')})$` : '');
    }
    return [dest, text];
  }));
  loaded.forEach(([dest, text]) => zip.file(dest, text));
  return true;
}

// "little-needs-222649.framer.app" → "little-needs-222649-framer-app-site"
// (no dots: a folder ending in ".app" looks like a broken app on macOS)
function siteFolderName(url) {
  let host = 'site';
  try { host = new URL(url || 'https://site').hostname || 'site'; } catch {}
  return (host.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'framer') + '-site';
}

function base64ToBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Download ───────────────────────────────────────────────────────────────
// Use URL.createObjectURL directly in popup — avoids Chrome message size limits
async function triggerDownload() {
  if (!extractedZip) return;

  try {
    // No dots in the name: "site.framer.app.zip" unzips to a folder ending in
    // ".app", which macOS shows as a broken application. Use dashes instead.
    const filename  = `${siteFolderName(currentTab.url)}.zip`;
    const objectUrl = URL.createObjectURL(extractedZip);

    const a = document.createElement('a');
    a.href     = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke after a delay so the download can start
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);

    addLog('ok', `Downloading ${filename}…`);
  } catch (err) {
    addLog('error', `Download failed: ${err.message}`);
    console.error('[FramerExtractor] Download error:', err);
  }
}

function showSuccess(title, byteSize, counts) {
  document.querySelector('.success-banner')?.remove();

  // Hide progress and log
  progressWrap.style.display = 'none';
  logWrap.style.display      = 'none';

  // Create success banner with bee
  const banner = document.createElement('div');
  banner.className = 'success-banner';
  banner.innerHTML = `
    <img class="success-banner__bee" src="assets/ff1abbe881bc6062e9d0f05bb4edc33b40c95e28.png" alt="" />
    <div class="success-banner__title">Sweet Build Ready!!!</div>
    <div class="success-banner__desc">Your site is ready— Download it, deploy on Vercel, or run locally. Need help? The README has you covered.</div>`;
  document.querySelector('.steps-card').insertAdjacentElement('beforebegin', banner);

  // Switch to dual-button layout: Re-Extract + Download ZIP
  const actionsEl = document.querySelector('.actions');
  actionsEl.className = 'actions actions--dual';
  actionsEl.innerHTML = `
    <div class="btn-outer btn-outer--secondary">
      <button class="btn btn--primary" id="re-extract-btn">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="#006DFF" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M8 2.5L10.5 2.5L8 0" stroke="#006DFF" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Re-Extract</span>
      </button>
    </div>
    <div class="btn-outer btn-outer--primary">
      <button class="btn btn--primary" id="download-btn-new">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2.5 12.5h11M8 2v8M5 7.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Download ZIP</span>
      </button>
    </div>`;

  // Re-bind events
  document.getElementById('re-extract-btn').addEventListener('click', () => {
    document.querySelector('.success-banner')?.remove();
    actionsEl.className = 'actions';
    actionsEl.innerHTML = `
      <div class="btn-outer">
        <button id="extract-btn" class="btn btn--primary">
          <img src="assets/download-icon.svg" alt="" class="btn__icon" />
          <span>Extract Site</span>
        </button>
      </div>
      <button id="download-btn" class="btn btn--download" style="display:none">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M2.5 12.5h10M7.5 1.5v8M4.5 7l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Download ZIP</span>
      </button>`;
    extractedZip = null;
    isRunning = false;
    // Reset steps
    hideCmsStep();
    ['scan','fetch','rewrite','zip'].forEach(id => {
      setStep(id, 'idle');
      setStepCount(id, '—');
    });
    startExtraction();
  });
  document.getElementById('download-btn-new').addEventListener('click', triggerDownload);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function localPath(asset) {
  const folders = { image:'assets/images', font:'assets/fonts', video:'assets/videos', cursor:'assets/cursors', script:'assets/js', style:'assets/css', other:'assets/other' };
  return `${folders[asset.type] || 'assets/other'}/${asset.name}`;
}

function dedup(assets) {
  const seen = new Map();
  assets.forEach(a => { if (!seen.has(a.url)) seen.set(a.url, a); });
  return [...seen.values()];
}

function resolveCollisions(assets) {
  const count = {};
  assets.forEach(a => { count[a.name] = (count[a.name] || 0) + 1; });
  const seen = {};
  assets.forEach(a => {
    if (count[a.name] > 1) {
      seen[a.name] = (seen[a.name] || 0) + 1;
      const dot  = a.name.lastIndexOf('.');
      const base = dot >= 0 ? a.name.slice(0, dot) : a.name;
      const ext  = dot >= 0 ? a.name.slice(dot)    : '';
      a.name = `${base}-${seen[a.name]}${ext}`;
    }
  });
}

function sendMsg(msg) {
  return new Promise((res, rej) => {
    chrome.tabs.sendMessage(currentTab.id, msg, r => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res(r);
    });
  });
}

function shortUrl(url) {
  try { return new URL(url).pathname.split('/').pop() || url.slice(0, 40); }
  catch { return String(url).slice(0, 40); }
}

function readme(title, url, count, info = {}) {
  const date  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const cms   = info.cms || [];
  const hasCms = !!info.admin;
  const site  = info.site || { isFramerHost: true };
  const seo   = info.seoNotes || { noindexPages: [] };
  const pages = info.pages || 1;
  const itemFolder = (cms.find(c => c.pageFolder) || {}).pageFolder || 'blog';

  const cmsSection = hasCms ? `
## ✏️ Edit your content (CMS)

1. Start the preview (step 1 above).
2. Open **http://localhost:8080/cms/**
3. Pick an item on the left. The middle shows your real site, scrolled to that item. Change fields on the right and the page updates as you type.
4. Click **Publish** (top-right or the bar at the bottom).

**Saving is automatic.** Every change is kept in this browser, even if you close the tab. **Publish** puts your changes on the site — the CMS picks the right way by itself:
- **On your computer:** saved straight into this folder. Then upload the folder again (Netlify Drop: your site → Deploys → drag the folder in).
- **On your live site** (after the setup below): one click and the live site updates.

**Your collections**

| Collection | Items | Pages |
|---|---|---|
${cms.map(c => `| ${c.name} | ${c.count} | ${c.pageFolder ? `\`/${c.pageFolder}/…\`` : 'shown inside other pages'} |`).join('\n')}

**Move your content elsewhere:** in the CMS, open **Export** for WordPress, Notion, Airtable, Webflow, Google Sheets or JSON. Each download includes every collection.

> Edits made in the CMS change this exported site only. Your Framer project isn't touched, so if you export from Framer again later, CMS-only edits are replaced.

### Edit from your live site (optional)

| Setup | You get | Publish speed |
|---|---|---|
| **Vercel + Blob** | Edit at \`your-site/cms\` from anywhere | Live in seconds |
| **Vercel + GitHub + Blob** | Same, and every publish is a GitHub commit (history, backups) | Live in seconds |
| **Vercel or Netlify + GitHub** | Every publish is a commit, the host redeploys | ~30 seconds |
| **Netlify Drop / GitHub Pages** | Edit on your computer, upload the folder again | When you upload |

**Doing it yourself (Vercel, ~2 minutes):**
1. Deploy this folder to Vercel (import a GitHub repo at vercel.com/new, or run \`npx vercel\` here).
2. Project → **Settings → Environment Variables** → add \`FX_ADMIN_PASSWORD\` = a password you choose. That's your CMS password.
3. Project → **Storage → Create → Blob** → connect it to the project (instant publishing).
4. **Deployments → ⋯ → Redeploy.** Open \`your-site/cms\` and sign in.

If you open \`/cms\` on your live site before this, it shows these same steps.

| Variable | What it's for |
|---|---|
| \`FX_ADMIN_PASSWORD\` | **Required.** Password to open \`/cms\` on the live site |
| \`BLOB_READ_WRITE_TOKEN\` | Added when you connect a **Vercel Blob** store → changes go live in seconds |
| \`GITHUB_TOKEN\` + \`GITHUB_REPO\` | Optional: every publish is also a GitHub commit (token: fine-grained, Contents read & write) |

The CMS is password-protected and hidden from search engines.

---
` : '';

  const seoLines = [];
  if (site.isFramerHost) {
    seoLines.push('- Canonical URLs follow the domain you deploy to, so Google treats your new domain as the original.');
    seoLines.push('- In `sitemap.xml`, replace `https://YOUR-DOMAIN.com` with your domain, then add the `Sitemap:` line in `robots.txt` and submit it in Google Search Console.');
  } else {
    seoLines.push(`- \`sitemap.xml\` and \`robots.txt\` are ready for ${site.origin}. Submit the sitemap in Google Search Console after deploying.`);
    seoLines.push('- Titles, descriptions, social images and canonical URLs are kept exactly as Framer made them.');
  }
  if (seo.noindexPages.length) seoLines.push(`- ⚠️ ${seo.noindexPages.length} page(s) are set to **noindex** in Framer, so search engines skip them (e.g. \`${seo.noindexPages.slice(0, 3).join('`, `')}\`).`);

  return `# ${title}

Exported from ${url} on ${date} with **Framer Extractor**. ${pages} page${pages === 1 ? '' : 's'}${cms.length ? ` · ${cms.length} CMS collection${cms.length === 1 ? '' : 's'}` : ''}.

## ⚡ Quick start (no coding needed)

1. **Preview:** double-click \`preview-mac.command\` (Mac) or \`preview-windows.bat\` (Windows). Your site opens at http://localhost:8080 — keep that window open while you work. It shows your site link${hasCms ? ' and your CMS link' : ''}.
   *Mac says "unidentified developer"? Right-click the file → Open → Open. Asked to install Node.js? It's free at nodejs.org.*
${hasCms ? '2. **Edit content:** open http://localhost:8080/cms/ — click Publish and your edits are saved into this folder.\n3' : '2'}. **Go live:** drag this whole folder onto **https://app.netlify.com/drop**. Free, live in seconds.
${hasCms ? '4' : '3'}. **Update later:** make your changes, then on Netlify open your site → **Deploys** → drag the folder in again.

Developers and AI tools: \`npm start\` (or \`npx serve\`) does the same as step 1 and prints your site${hasCms ? ' and CMS' : ''} links.

> Don't double-click \`index.html\` or use \`python -m http.server\` / VS Code Live Server: some pages won't open${hasCms ? " and the CMS can't save" : ''}. Use the preview launcher, \`npm start\` or \`npx serve\` (in this folder it runs the site's own server).

## 🤖 Using Claude Code, Codex, Cursor or another AI tool

Open this folder in your tool and just say what you want. Claude Code reads **CLAUDE.md**; Codex, Cursor and most others read **AGENTS.md** (same instructions).

| Say this | What happens |
|---|---|
| *"Run this site"* | Runs \`npm start\` and gives you your site link${hasCms ? ' and your CMS link' : ''} |
${hasCms ? `| *"Deploy this site to Vercel and set up the CMS"* | Asks you for a CMS password, deploys, connects Vercel Blob (edits go live in seconds) and gives you two links: **your site** and **your CMS** |
| *"Put this site on GitHub and Vercel with the CMS"* | Same, plus a private GitHub repo so every edit is also a commit. It asks you to create a GitHub token yourself |
` : `| *"Deploy this site to Vercel"* | Deploys it and gives you your live link |
`}| *"Update my live site"* | Uploads your latest local changes to the same site |

You'll be asked to sign in to Vercel${hasCms ? '/GitHub' : ''} in your browser the first time.${hasCms ? ' Your CMS password is never saved in this folder.' : ''}

---
${cmsSection}
## 🚀 Deploy (free)

| Host | How |
|---|---|
| **Netlify** | Drag the folder onto https://app.netlify.com/drop |
| **Vercel** | Import a GitHub repo at https://vercel.com/new, or run \`npx vercel\` here |
| **Cloudflare Pages** | https://pages.cloudflare.com → Upload assets → choose this folder |
| **GitHub Pages** | Upload to a repo → Settings → Pages → Deploy from branch |

No build step. **Custom domain:** add it in your host's settings, then point your DNS there (remove it from Framer first).

**Update the design later:** change it in Framer → publish → export again → redeploy.

---

## 🔎 SEO

${seoLines.join('\n')}

---

## 🧩 Good to know

- **Forms** still send to Framer. For full independence, point them to Formspree, Web3Forms or Basin.
- **Password-protected pages, site search and language switcher** rely on Framer's servers and may not work.
- **Changing text on non-CMS pages:** edit it in Framer and export again. Framer re-renders pages from its JavaScript when they load, so edits made only in the HTML can be undone.
${info.leftovers ? `- ${info.leftovers} image size variant(s) still load from Framer's servers.\n` : ''}
## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| Blank page / no animations | Use the preview script or a host, not a double-clicked file |
| Page not found on the host | Check that the page folder exists (e.g. \`${itemFolder}/my-item/index.html\`) |
${hasCms ? '| CMS says it can\'t load | Open it through the preview script: http://localhost:8080/cms/ |\n' : ''}
---

🤖 AI tools: see "Using Claude Code, Codex, Cursor" above. CLAUDE.md / AGENTS.md explain how this export works and what's safe to change.

*Only export sites you own or have permission to export.*
`;
}

// Technical guide for AI coding tools (Claude Code, Cursor, Copilot…)
function agentsGuide(title, url, info = {}) {
  const hasCms = !!info.admin;
  return `# ${title} — guide for AI assistants (Claude, Cursor, Copilot…)

Static export of the Framer site ${url}, made by Framer Extractor.

## ▶ Run it (do this, nothing else)

\`\`\`bash
npm start
\`\`\`

That runs \`node preview-server.mjs\` (Node.js only, no install needed) and opens http://localhost:8080 — it moves to the next free port if 8080 is busy and prints the real address.${hasCms ? ' The CMS is at **/cms/** on that same address.' : ''}

**Then tell the user the links it printed:** \`Your site\`${hasCms ? ' and \`CMS\`' : ''} (e.g. http://localhost:8080${hasCms ? ' and http://localhost:8080/cms/' : ''}).

\`npx serve\` and \`npx http-server\` also work here: this folder's package.json maps them to the same server (so the CMS can save and both links are printed). **Do not** use \`python -m http.server\`, Vite or VS Code Live Server:
- page folders whose names contain dots (e.g. \`article/my.site/\`) show a folder listing instead of the page,
${hasCms ? "- the CMS can't save: Publish only works through `preview-server.mjs` (it writes into this folder via a localhost-only `/api/fx-cms`),\n" : ''}- unknown URLs won't get the site's \`404.html\`.

No build step, no \`npm install\` needed to run locally. Never open \`index.html\` via \`file://\`.

To deploy: upload the folder as-is (Netlify Drop, Vercel, Cloudflare Pages, GitHub Pages). No build step.${hasCms ? '' : `

**Deploy to Vercel:** \`npx vercel deploy --prod --yes\`, then give the user the live URL it prints. **Update later:** run the same command again in this folder.`}
${hasCms ? `
## ▶ Deploy with a working CMS (follow exactly when the user asks to deploy / "set up the CMS")

The CMS at \`/cms\` saves online only on hosts that run its function (\`api/fx-cms\`): **Vercel** (best) or **Netlify**. On files-only hosts (Netlify Drop, GitHub Pages, Cloudflare upload) the user edits locally (\`npm start\` → \`/cms\` → Publish saves into this folder) and uploads the folder again.

1. **Ask the user for a CMS password.** Never invent, print or commit one. It becomes the \`FX_ADMIN_PASSWORD\` environment variable.
2. **Vercel via CLI** (no Git; changes go live in seconds through Vercel Blob):
   \`\`\`bash
   npx vercel deploy --prod --yes                     # first deploy, creates the project
   printf '%s' "<password>" | npx vercel env add FX_ADMIN_PASSWORD production
   npx vercel blob create-store <project>-cms --access public --yes   # connects Blob, adds BLOB_READ_WRITE_TOKEN
   npx vercel deploy --prod --yes                     # redeploy so the variables apply
   \`\`\`
3. **Vercel + GitHub** (every publish is a commit): push this folder to a GitHub repo, import it on Vercel (or \`npx vercel link\` + \`npx vercel git connect\`). Add \`FX_ADMIN_PASSWORD\`, \`GITHUB_REPO\` (\`owner/name\`) and optionally \`GITHUB_BRANCH\`. **Ask the user** to create a fine-grained GitHub token (Contents: Read and write, only this repo) and add it as \`GITHUB_TOKEN\` in the Vercel dashboard themselves — never handle the token. Also create a Blob store (command above) so edits are live in seconds *and* committed. Redeploy.
4. **Netlify** (Git-connected site): same variables as step 3 except Blob (Vercel only); Netlify redeploys after each commit.
5. **Verify:** \`curl -s <site>/api/fx-cms\` must show \`"configured":true\` and \`"blob":true\` and/or \`"github":true\`.
6. **Finish by giving the user exactly two links:**
   - **Site:** \`<site URL>\`
   - **CMS:** \`<site URL>/cms/\` — sign in with the password they chose.

**"Update my live site":** CLI setup → \`npx vercel deploy --prod --yes\` in this folder (same project). GitHub setup → commit and push; Vercel redeploys. Then give the two links again.

Notes: avoid "github" in a \`*.vercel.app\` project name (browser phishing filters block such addresses). Publishing mode is automatic: local folder → Blob+GitHub → Blob → GitHub → download.
` : ''}
## Layout
- \`index.html\`, \`<page>/index.html\`: one pre-rendered HTML file per page. Framer hydrates them with React.
- \`assets/js/*.mjs\`: Framer runtime + page/component modules. Minified; asset URLs inside were rewritten to local paths. **Don't reformat or bundle.**
- \`assets/images|fonts|videos|cursors/\`: local copies of every asset. \`styles.css\`: empty, for your own CSS overrides (loads last; Framer's styles stay inline in each page).
- \`404.html\`, \`sitemap.xml\`, \`robots.txt\`, \`.nojekyll\`.
${hasCms ? `- \`cms/\`: the CMS editor app (prebuilt). \`cms/fx-site.json\` maps collections → fields, data files, JS modules and item pages. \`cms/data/*.csv|json\`: read-only exports.
- \`assets/cms/*.framercms\`: **binary** CMS data that Framer reads at runtime.
- \`api/\`, \`netlify/functions/\`, \`fx-server/handler.mjs\`, \`middleware.js\`, \`package.json\`, \`netlify.toml\`: optional backend for publishing from the live \`/cms\` (GitHub commit or Vercel Blob). Env: \`FX_ADMIN_PASSWORD\`, \`GITHUB_TOKEN\`, \`GITHUB_REPO\`, \`GITHUB_BRANCH\`, \`GITHUB_DIR\`, \`BLOB_READ_WRITE_TOKEN\`.
` : ''}
## Injected at the top of every page's <head> (keep it first)
1. Root detection: \`var P="<page path>"\` works out the site root (domain root, subfolder or file://) and writes \`<base href>\`. If you add or move a page, set \`P\` to its folder path.
2. URL shim: \`new URL("assets/…")\` resolves against the page base (Framer's image code needs absolute URLs).
${hasCms ? `3. CMS fetch interceptor: requests for \`*.framercms\` are served from \`assets/cms/\`, including Framer's \`?range=a-b,c-d\` partial reads (bytes are sliced locally).
` : ''}
## Editing rules
- **Text on non-CMS pages lives in the JS page modules as well as the HTML.** To change it, update the string in the page's HTML *and* in the matching \`assets/js/*.mjs\`, or the old text returns on hydration. Safer: change it in Framer and re-export.
- **Styling:** put CSS overrides in \`styles.css\` (it loads after Framer's styles). Don't move Framer's inline \`<style>\` blocks out of the pages.
${hasCms ? `- **CMS content: never hand-edit \`assets/cms/*.framercms\`.** Items are located by byte offset through index files. Use the CMS at \`/cms\`. On publish it re-encodes the data, sets the collection module's \`indexes:[]\` so Framer scans instead of seeking, removes \`__framer__handoverData\` from pages, and patches/creates item pages.
- \`cms/data/*\` are generated copies. Editing them changes nothing on the site.
` : ''}- Don't remove \`data-framer-*\` attributes or the \`<!--$-->\` hydration comments; animations depend on them.
`;
}

// ── Multi-page helpers ──────────────────────────────────────────────────────

function extractInternalPageUrls(html, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set([base.pathname.replace(/\/$/, '') || '/']);
  const pages = [];
  const hrefRe = /href=["']([^"']+)["']/g;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.origin !== base.origin) continue;
      const pathname = url.pathname.replace(/\/$/, '') || '/';
      if (seen.has(pathname)) continue;
      if (/\.(pdf|zip|jpg|jpeg|png|gif|svg|webp|mp4|mp3|wav|css|js|json|xml|txt)$/i.test(pathname)) continue;
      if (/^\/(api|cdn-cgi|_next|static|assets)\//.test(pathname)) continue;
      seen.add(pathname);
      pages.push(url.origin + url.pathname);
    } catch {}
  }
  return pages;
}

// ── Network ─────────────────────────────────────────────────────────────────
// Downloads run directly in the popup (extension pages may fetch any host in
// host_permissions, no CORS) as raw bytes — no base64 round-trip through the
// service worker. Every request has a timeout: a stuck file is skipped with a
// warning instead of freezing the whole extraction.
const TEXT_TIMEOUT = 45000;   // pages, scripts, data
const BIN_IDLE     = 30000;   // binary: abort if no bytes arrive for 30s
const BIN_MAX      = 240000;  // binary: hard cap (large videos)
async function netFetch(msg) {
  const ctrl = new AbortController();
  const isText = msg.type === 'FETCH_TEXT';
  let timer = setTimeout(() => ctrl.abort(), isText ? TEXT_TIMEOUT : BIN_MAX);
  try {
    const res = await fetch(msg.url, { cache: 'no-store', signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok && !msg.anyStatus) throw new Error(`HTTP ${res.status}`);
    if (isText) return { success: true, text: await res.text(), url: msg.url };
    // Stream binary so a stalled transfer is detected
    const reader = res.body.getReader();
    const parts = []; let size = 0; let idle;
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), BIN_IDLE); };
    bump();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); size += value.length; bump();
    }
    clearTimeout(idle);
    const bytes = new Uint8Array(size); let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
    return { success: true, bytes, url: msg.url };
  } catch (e) {
    return { success: false, error: e.name === 'AbortError' ? 'timed out' : e.message, url: msg.url };
  } finally { clearTimeout(timer); }
}

// Continuous worker pool: each finished download immediately starts the next
async function downloadPool(assets, size, onResult) {
  let next = 0;
  const worker = async () => {
    while (next < assets.length) {
      const asset = assets[next++];
      const res = await netFetch({ type: asset.type === 'script' ? 'FETCH_TEXT' : 'FETCH_ASSET', url: asset.url });
      onResult({ ...res, asset });
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, assets.length) }, worker));
}

function pathKey(u) {
  try { return new URL(u).pathname.replace(/\/$/, '') || '/'; } catch { return String(u); }
}

// Ask the background worker for text (bypasses CORS)
function sendBg(msg) {
  return netFetch(msg);
}

// Links on the start page + every <loc> in the site's sitemap.xml.
// Framer's sitemap lists CMS item pages, which are NOT linked from the nav.
async function discoverPages(html, pageUrl) {
  const base     = new URL(pageUrl);
  const basePath = pathKey(pageUrl);
  const found    = new Map(); // pathname -> { url, viaLink }
  extractInternalPageUrls(html, pageUrl).forEach(u => found.set(pathKey(u), { url: u, viaLink: true }));
  try {
    const r = await sendBg({ type: 'FETCH_TEXT', url: base.origin + '/sitemap.xml' });
    if (r?.success) {
      for (const m of r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        try {
          const u = new URL(m[1].replace(/&amp;/g, '&'));
          if (u.origin !== base.origin) continue;
          const p = u.pathname.replace(/\/$/, '') || '/';
          if (p === '/' || p === basePath || /^\/404$/.test(p) || found.has(p)) continue;
          found.set(p, { url: u.origin + u.pathname, viaLink: false });
        } catch {}
      }
    }
  } catch {}
  return [...found.values()];
}

// Scan raw server-rendered HTML for Framer assets (same typing as content.js)
function scanAssetsFromHtml(html) {
  const out  = { images: [], videos: [], fonts: [], cursors: [], scripts: [], uncategorised: [] };
  const seen = new Set();
  const re   = /https:\/\/framerusercontent\.com\/[^\s"'<>\)\]\\]+/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[0].replace(/&amp;/g, '&').replace(/["'\)\]\s>]+$/, '');
    if (seen.has(u) || u.endsWith('.json')) continue;
    seen.add(u);
    const clean = u.split('?')[0].split('#')[0];
    if (clean.endsWith('/')) continue; // folder-style URL, not a file
    const last  = clean.split('/').pop() || '';
    const ext   = (last.includes('.') ? last.split('.').pop() : 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const type  = /^(mjs|js)$/.test(ext)                      ? 'script'
                : /^(mp4|webm|ogg|mov|m4v)$/.test(ext)        ? 'video'
                : /^(woff2?|ttf|otf|eot)$/.test(ext)          ? 'font'
                : /^(png|jpe?g|gif|webp|avif|svg)$/.test(ext) ? 'image'
                : /^css$/.test(ext)                           ? 'style'
                : 'other';
    const name  = clean.split('/').pop() || `asset.${ext}`;
    const key   = type === 'script' ? 'scripts' : type === 'video' ? 'videos' : type === 'font' ? 'fonts'
                : type === 'image' ? 'images' : 'uncategorised';
    out[key].push({ url: u, type, name });
  }
  return out;
}

function mergeAssets(into, from) {
  if (!from) return into;
  ['images','videos','fonts','cursors','scripts','uncategorised'].forEach(k => {
    into[k] = into[k] || [];
    const seen = new Set(into[k].map(a => a.url));
    (from[k] || []).forEach(a => { if (!seen.has(a.url)) { seen.add(a.url); into[k].push(a); } });
  });
  return into;
}

async function fetchPageFromServer(url, anyStatus = false) {
  const r = await sendBg({ type: 'FETCH_TEXT', url, anyStatus });
  if (!r?.success || !r.text) return null;
  const title = (r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  return { html: r.text, pageTitle: title.trim(), inline: { css: [], js: [] }, assets: scanAssetsFromHtml(r.text) };
}

async function extractPageInBackground(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabLoad(tab.id);
    await new Promise(r => setTimeout(r, 1500)); // let JS settle
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    return await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' }, (r) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    });
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 30000); // 30s timeout
  });
}

function findCmsChunks(fetchedFiles) {
  const seen = new Set();
  const chunks = [];
  // Pattern: new URL(`./chunk.framercms`, `https://framerusercontent.com/.../file.js`).href.replace(`/modules/`, `/cms/`)
  // Always scan the ORIGINAL text (rewrittenText may have changed URLs).
  // The trailing .href.replace('/modules/','/cms/') is optional so minor
  // Framer bundler changes don't silently drop CMS data.
  const re = /new URL\(\s*[`'"](\.\/[^`'"]+\.framercms)[`'"]\s*,\s*[`'"](https:\/\/[^`'"]+\.js)[`'"]\s*\)(\.href\.replace\(\s*[`']\/modules\/[`']\s*,\s*[`']\/cms\/[`']\s*\))?/g;
  Object.values(fetchedFiles).filter(f => f.text).forEach(f => {
    const text = f.text || '';
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const chunkPath = m[1];
        const baseUrl   = m[2];
        let cmsUrl      = new URL(chunkPath, baseUrl).href;
        if (m[3] || cmsUrl.includes('/modules/')) cmsUrl = cmsUrl.replace('/modules/', '/cms/');
        const name      = chunkPath.replace('./', '');
        if (!seen.has(cmsUrl)) {
          seen.add(cmsUrl);
          chunks.push({ url: cmsUrl, name });
        }
      } catch {}
    }
  });
  return chunks;
}
