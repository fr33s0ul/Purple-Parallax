# Cybersecurity Atlas

A self-contained, canvas-accelerated knowledge map for the fr33s0ul Cybersecurity Atlas. The atlas preserves the original UX: radial sector layout, drag/zoom navigation, minimap, search, filters, favorites, PNG export, theming, and keyboard shortcuts.

## Usage

- Local open: just double-click `docs/index.html` and explore the atlas offline.
- Favorites and theme choices persist automatically in `localStorage`.

## Publishing with GitHub Pages

1. Commit your changes to the `main` branch and push to GitHub.
2. In repository **Settings → Pages**, choose **Deploy from a branch** with the `main` branch and `/docs` folder.
3. Save. GitHub Pages will publish `docs/index.html` at your repository Pages URL. Refer to the [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) for troubleshooting and advanced configuration.

## Future work

- Evaluate higher-scale renderers such as [`d3-force`](https://github.com/d3/d3-force), [`force-graph`](https://github.com/vasturiano/force-graph), or [`react-force-graph`](https://github.com/vasturiano/react-force-graph) if the taxonomy grows to 10k+ nodes.
- Consider enabling the optional layout persistence snippet (documented inline in `docs/index.html`) if collaborative layout tweaks are needed.
