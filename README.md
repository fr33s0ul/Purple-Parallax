# Cybersecurity Atlas

An interactive, radial knowledge map for the fr33s0ul blog. The atlas streams
branch data on demand, renders with a lightweight canvas viewer, and can be
served directly from this repository.

## Development

1. Update the branch layouts (optional) by regenerating the data files:

   ```bash
   python tools/build_data.py
   ```

2. Launch any static server from the repository root and open `CyberAtlas.html`
   in your browser, or simply double-click the file for offline viewing. The
   viewer loads additional branch JSON on demand from the `data/` directory.

## Publishing to GitHub Pages

The repository includes a `docs/` directory that is ready for GitHub Pages. To
refresh it after making content or layout changes, run:

```bash
python tools/publish_site.py
```

This copies the latest `CyberAtlas.html` and all JSON data into `docs/`. Enable
GitHub Pages in the repository settings and choose the **`docs/` folder** as the
source to host the atlas directly from the repo.
