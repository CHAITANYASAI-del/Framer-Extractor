<p align="center">
  <img src="framer-extractor/icons/icon128.png" width="96" height="96" alt="Framer Extractor logo">
</p>

<h1 align="center">Framer Extractor</h1>

<p align="center">
  <b>Export any Framer website to clean HTML, CSS &amp; JS — with every page, every CMS item and a built-in CMS to keep editing it.</b><br>
  Self-host free on Netlify, Vercel, GitHub Pages or any web host.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/framer-extractor/kinidcikijcmafdcpbgfglbemdhlelln">
    <img src="https://img.shields.io/badge/Chrome%20Web%20Store-Add%20to%20Chrome-4285F4?logo=googlechrome&logoColor=white&style=for-the-badge" alt="Add to Chrome">
  </a>
  <img src="https://img.shields.io/badge/version-3.0-F5C842?style=for-the-badge" alt="Version 3.0">
  <img src="https://img.shields.io/badge/price-free-2EA44F?style=for-the-badge" alt="Free">
  <img src="https://img.shields.io/badge/license-source--available-lightgrey?style=for-the-badge" alt="Source-available license">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/framer-extractor/kinidcikijcmafdcpbgfglbemdhlelln"><b>→ Install Framer Extractor from the Chrome Web Store</b></a>
</p>

---

## Why

Framer doesn't offer an HTML export. Framer Extractor does — right in your browser.
Open your published Framer site, click the extension, and download a ready-to-deploy
static site. No account, no paywall, and nothing is uploaded to any server: the whole
export runs on your computer.

## Features

- **Full site export** — every page (found automatically from your sitemap, including
  pages not linked in the menu), animations, fonts, images and videos.
- **Framer CMS support** — blog posts, case studies, projects and every other collection
  item page are exported and work offline.
- **Built-in CMS at `/cms`** — edit your content after export with a live preview of your
  site side by side: text, rich text, images, references; add, duplicate, reorder or
  delete items. Light and dark mode. Password-protected when hosted.
- **Publish your way** — save straight into your site folder, commit to GitHub (Vercel,
  Netlify and Cloudflare redeploy automatically), or go live in seconds with Vercel Blob.
- **Move your content anywhere** — one-click exports for WordPress, Notion, Airtable,
  Webflow, Google Sheets, CSV and JSON.
- **SEO-ready** — `sitemap.xml`, `robots.txt`, your Framer 404 page, and canonical tags
  fixed for your new domain. Your own analytics (GA4, GTM, Plausible) are kept.
- **One-command local preview** — `npm start` (or double-click on Mac / Windows) shows
  your site and your CMS links in the terminal.
- **Works with AI coding tools** — every export includes an `AGENTS.md`, so Claude Code,
  Codex or Cursor can run, deploy and set up the CMS for you.

## Install

**From the Chrome Web Store (recommended):**
[Framer Extractor on the Chrome Web Store](https://chromewebstore.google.com/detail/framer-extractor/kinidcikijcmafdcpbgfglbemdhlelln)

**From this repository (for reviewing the code):**

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `framer-extractor` folder.

## How to use

1. Open your **published** Framer site (for example `yoursite.framer.website` or your
   custom domain) in Chrome.
2. Click the **Framer Extractor** icon and press **Export**.
3. Unzip the download and run it locally:

   ```bash
   cd your-site-folder
   npm start
   ```

   The terminal shows two links: **Your site** (`http://localhost:8080`) and, if your
   site uses Framer CMS, **CMS** (`http://localhost:8080/cms/`).
4. Deploy the folder to any host. Each export's own `README.md` walks you through
   Netlify, Vercel, GitHub Pages and setting up the CMS on a live site.

## Repository layout

```
framer-extractor/     The Chrome extension (Manifest V3) — load this folder into Chrome
├─ manifest.json
├─ popup.html/.css/.js   Export UI and the export engine
├─ background.js         Service worker
├─ content.js, cms.js    Page and Framer CMS readers
├─ admin-dist/           Built CMS editor, copied into every export as /cms
└─ site-kit/             Files added to exports: preview server, CMS save API,
                         Vercel middleware, Netlify functions
admin-src/            Source of the CMS editor (React + Vite)
```

### Building the CMS editor

The extension already contains a built copy in `framer-extractor/admin-dist`. To rebuild
it after changing `admin-src`:

```bash
cd admin-src
npm install
npm run build
```

## Privacy

Framer Extractor runs entirely in your browser. It has no server, collects no analytics
and never sends your site or content anywhere. It only downloads the files of the Framer
site you are exporting (plus the popup's own fonts from Google Fonts).

## License

**Source-available, not open source.** You can read the code, use the extension and do
whatever you like with the websites you export — including the CMS and server files
added to them. Copying, reusing or redistributing this code, or publishing a modified
version of the extension, needs written permission. See [LICENSE](LICENSE).

Framer is a trademark of Framer B.V. Framer Extractor is an independent tool and is not
affiliated with or endorsed by Framer.

---

<p align="center">Crafted &amp; developed by <b>Chaitanya Sai</b></p>
