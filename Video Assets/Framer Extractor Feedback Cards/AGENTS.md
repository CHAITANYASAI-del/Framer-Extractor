# Review Carousel — guide for AI assistants (Claude, Cursor, Copilot…)

Static export of the Framer site https://reviewcarousel.framer.website/, made by Framer Extractor.

## ▶ Run it (do this, nothing else)

```bash
npm start
```

That runs `node preview-server.mjs` (Node.js only, no install needed) and opens http://localhost:8080 — it moves to the next free port if 8080 is busy and prints the real address.

**Then tell the user the links it printed:** `Your site` (e.g. http://localhost:8080).

`npx serve` and `npx http-server` also work here: this folder's package.json maps them to the same server (so the CMS can save and both links are printed). **Do not** use `python -m http.server`, Vite or VS Code Live Server:
- page folders whose names contain dots (e.g. `article/my.site/`) show a folder listing instead of the page,
- unknown URLs won't get the site's `404.html`.

No build step, no `npm install` needed to run locally. Never open `index.html` via `file://`.

To deploy: upload the folder as-is (Netlify Drop, Vercel, Cloudflare Pages, GitHub Pages). No build step.

**Deploy to Vercel:** `npx vercel deploy --prod --yes`, then give the user the live URL it prints. **Update later:** run the same command again in this folder.

## Layout
- `index.html`, `<page>/index.html`: one pre-rendered HTML file per page. Framer hydrates them with React.
- `assets/js/*.mjs`: Framer runtime + page/component modules. Minified; asset URLs inside were rewritten to local paths. **Don't reformat or bundle.**
- `assets/images|fonts|videos|cursors/`: local copies of every asset. `styles.css`: empty, for your own CSS overrides (loads last; Framer's styles stay inline in each page).
- `404.html`, `sitemap.xml`, `robots.txt`, `.nojekyll`.

## Injected at the top of every page's <head> (keep it first)
1. Root detection: `var P="<page path>"` works out the site root (domain root, subfolder or file://) and writes `<base href>`. If you add or move a page, set `P` to its folder path.
2. URL shim: `new URL("assets/…")` resolves against the page base (Framer's image code needs absolute URLs).

## Editing rules
- **Text on non-CMS pages lives in the JS page modules as well as the HTML.** To change it, update the string in the page's HTML *and* in the matching `assets/js/*.mjs`, or the old text returns on hydration. Safer: change it in Framer and re-export.
- **Styling:** put CSS overrides in `styles.css` (it loads after Framer's styles). Don't move Framer's inline `<style>` blocks out of the pages.
- Don't remove `data-framer-*` attributes or the `<!--$-->` hydration comments; animations depend on them.
