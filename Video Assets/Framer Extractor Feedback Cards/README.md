# Framer Extractor Feedback Cards

Exported from https://reviewcarousel.framer.website/ on November 21, 2026 with **Framer Extractor**. 1 page.

## ⚡ Quick start (no coding needed)

1. **Preview:** double-click `preview-mac.command` (Mac) or `preview-windows.bat` (Windows). Your site opens at http://localhost:8080 — keep that window open while you work. It shows your site link.
   *Mac says "unidentified developer"? Right-click the file → Open → Open. Asked to install Node.js? It's free at nodejs.org.*
2. **Go live:** drag this whole folder onto **https://app.netlify.com/drop**. Free, live in seconds.
3. **Update later:** make your changes, then on Netlify open your site → **Deploys** → drag the folder in again.

Developers and AI tools: `npm start` (or `npx serve`) does the same as step 1 and prints your site links.

> Don't double-click `index.html` or use `python -m http.server` / VS Code Live Server: some pages won't open. Use the preview launcher, `npm start` or `npx serve` (in this folder it runs the site's own server).

## 🤖 Using Claude Code, Codex, Cursor or another AI tool

Open this folder in your tool and just say what you want. Claude Code reads **CLAUDE.md**; Codex, Cursor and most others read **AGENTS.md** (same instructions).

| Say this | What happens |
|---|---|
| *"Run this site"* | Runs `npm start` and gives you your site link |
| *"Deploy this site to Vercel"* | Deploys it and gives you your live link |
| *"Update my live site"* | Uploads your latest local changes to the same site |

You'll be asked to sign in to Vercel in your browser the first time.

---

## 🚀 Deploy (free)

| Host | How |
|---|---|
| **Netlify** | Drag the folder onto https://app.netlify.com/drop |
| **Vercel** | Import a GitHub repo at https://vercel.com/new, or run `npx vercel` here |
| **Cloudflare Pages** | https://pages.cloudflare.com → Upload assets → choose this folder |
| **GitHub Pages** | Upload to a repo → Settings → Pages → Deploy from branch |

No build step. **Custom domain:** add it in your host's settings, then point your DNS there (remove it from Framer first).

**Update the design later:** change it in Framer → publish → export again → redeploy.

---

## 🔎 SEO

- Canonical URLs follow the domain you deploy to, so Google treats your new domain as the original.
- In `sitemap.xml`, replace `https://YOUR-DOMAIN.com` with your domain, then add the `Sitemap:` line in `robots.txt` and submit it in Google Search Console.

---

## 🧩 Good to know

- **Forms** still send to Framer. For full independence, point them to Formspree, Web3Forms or Basin.
- **Password-protected pages, site search and language switcher** rely on Framer's servers and may not work.
- **Changing text on non-CMS pages:** edit it in Framer and export again. Framer re-renders pages from its JavaScript when they load, so edits made only in the HTML can be undone.

## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| Blank page / no animations | Use the preview script or a host, not a double-clicked file |
| Page not found on the host | Check that the page folder exists (e.g. `blog/my-item/index.html`) |

---

🤖 AI tools: see "Using Claude Code, Codex, Cursor" above. CLAUDE.md / AGENTS.md explain how this export works and what's safe to change.

*Only export sites you own or have permission to export.*
