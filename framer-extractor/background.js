// background.js — Service Worker (Manifest V3)
// Fetches assets with extension privileges (bypasses CORS)
// Supports both binary (base64) and text mode for JS/CSS rewriting

'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Fetch asset as BASE64 (images, fonts, videos, cursors) ───────────────
  if (msg.type === 'FETCH_ASSET') {
    fetch(msg.url, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then(buffer => {
        const bytes  = new Uint8Array(buffer);
        let binary   = '';
        // chunk to avoid call stack overflow on large files
        const CHUNK  = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        sendResponse({
          success: true,
          base64: btoa(binary),
          contentType: guessType(msg.url),
          url: msg.url,
        });
      })
      .catch(err => sendResponse({ success: false, error: err.message, url: msg.url }));

    return true; // keep channel open
  }

  // ── Fetch JS / CSS as TEXT (so we can rewrite URLs inside bundles) ───────
  if (msg.type === 'FETCH_TEXT') {
    fetch(msg.url, { cache: 'no-store' })
      .then(res => {
        // anyStatus: accept error pages (e.g. Framer's designed /404 page)
        if (!res.ok && !msg.anyStatus) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(text => sendResponse({ success: true, text, url: msg.url }))
      .catch(err => sendResponse({ success: false, error: err.message, url: msg.url }));

    return true;
  }

  // ── Trigger ZIP download ─────────────────────────────────────────────────
  if (msg.type === 'DOWNLOAD_ZIP') {
    chrome.downloads.download(
      { url: msg.dataUrl, filename: msg.filename, saveAs: true },
      id => {
        if (chrome.runtime.lastError)
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        else
          sendResponse({ success: true, downloadId: id });
      }
    );
    return true;
  }

});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function guessType(url) {
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  return ({
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
    gif:'image/gif', svg:'image/svg+xml', webp:'image/webp', avif:'image/avif',
    woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf', otf:'font/otf',
    mp4:'video/mp4', webm:'video/webm', ogg:'video/ogg', mov:'video/mp4',
    mjs:'text/javascript', js:'text/javascript', css:'text/css',
    json:'application/json',
  })[ext] || 'application/octet-stream';
}
