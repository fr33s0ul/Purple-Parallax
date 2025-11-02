# Cybersecurity Atlas

A self-contained, canvas-accelerated knowledge map for the fr33s0ul Cybersecurity Atlas. The atlas preserves the original UX: radial sector layout, drag/zoom navigation, minimap, search, filters, favorites, PNG export, theming, and keyboard shortcuts.

## Usage

- Local open: just double-click `docs/index.html` and explore the atlas offline.
- Favorites and theme choices persist automatically in `localStorage`.

## Local preview

The published build is the static `docs` directory. To preview it exactly as GitHub Pages serves it:

1. (Optional) Install the tooling used for dataset validation to warm the local cache:
   ```bash
   npm install
   ```
   The `npm run validate-dataset` script downloads the CLI from npm on demand, so an internet connection is required the first time it runs.
2. Start a local web server from the repository root:
   ```bash
   python -m http.server 8000 -d docs
   ```
3. Visit [http://127.0.0.1:8000/](http://127.0.0.1:8000/) and confirm the spinner clears without console errors.

## Troubleshooting GitHub Pages paths

- Asset URLs are expressed relative to the repository (`./app.js`, `./styles.css`), so GitHub Pages will resolve them correctly at `https://<user>.github.io/<repo>/`.
- Dataset requests derive from `document.baseURI`, which prevents `404` responses when the site is hosted under a project subdirectory.
- If a cached script or stylesheet refuses to update after deployment, bump the `?v=` query strings in `docs/index.html` and redeploy.

## Contributing data updates

The atlas accepts pull requests that edit `docs/data/atlas.json`. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the JSON schema, validation workflow, and collaboration tips.

## Publishing with GitHub Pages

1. Commit your changes to the `main` branch and push to GitHub.
2. In repository **Settings → Pages**, choose **Deploy from a branch** with the `main` branch and `/docs` folder.
3. Save. GitHub Pages will publish `docs/index.html` at your repository Pages URL. Refer to the [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) for troubleshooting and advanced configuration.

## Manual QA checklist

- Expand a branch, activate **Collapse**, and confirm the URL hash resets to the macro-bucket view (focus ID cleared). Use **Back** to return to the expanded view and ensure the stack navigation restores the prior hash and layout.

## Accessibility audit

- Automated `axe`/Lighthouse checks cannot be executed inside the container because outbound npm registry requests are blocked (`E403`). Run `npx @axe-core/cli http://localhost:4173/index.html` and `npx lighthouse http://localhost:4173/index.html --only-categories=accessibility --chrome-flags="--headless --no-sandbox"` locally to capture scores.
- Manual review after the keyboard and screen-reader updates confirms:
  - All primary controls (canvas, filters, outline, help modal) are reachable via keyboard focus order.
  - The onboarding and shortcut modals trap focus and announce their content.
  - The new screen-reader outline exposes a fully textual, collapsible navigation tree.
- Remaining exceptions:
  - The minimap interactions are still pointer-driven; rely on the keyboard navigation controls and Reset/Center actions when using assistive tech.
  - Canvas relationships are conveyed visually; screen-reader users should rely on the outline/list alternatives until richer textual descriptions are authored.

## Future work

- Evaluate higher-scale renderers such as [`d3-force`](https://github.com/d3/d3-force), [`force-graph`](https://github.com/vasturiano/force-graph), or [`react-force-graph`](https://github.com/vasturiano/react-force-graph) if the taxonomy grows to 10k+ nodes.
- Consider enabling the optional layout persistence snippet (documented inline in `docs/index.html`) if collaborative layout tweaks are needed.
