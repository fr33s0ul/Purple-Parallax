# Cybersecurity Atlas

An interactive, radial knowledge map for the fr33s0ul blog. The atlas streams
branch data on demand, renders with a lightweight canvas viewer, and can be
served directly from this repository.

## Development

1. Update the branch layouts (optional) by regenerating the data files:

   ```bash
   python tools/build_data.py
   ```

2. Launch any static server from the `docs/` directory and open `index.html`
   in your browser. (If you open the file directly from disk, use a browser
   that allows `file://` fetches or prefer running a static server.) The
   viewer loads additional branch JSON on demand from the `data/` directory.

## Publishing to GitHub Pages

The repository includes a `docs/` directory that is ready for GitHub Pages. To
refresh it after making content or layout changes, run:

```bash
python tools/publish_site.py
```

This copies the latest JSON data into `docs/data/`.

To host the atlas directly from GitHub:

1. Push your changes to the branch that will publish the site (typically
   `main`).
2. In **Settings → Pages**, pick **Deploy from a branch**.
3. Choose the publishing branch (for example `main`) and set the folder to
   **`/docs`** instead of `/ (root)`.
4. Save the configuration. GitHub Pages will serve `docs/index.html` and the
   JSON under `docs/data/` at `https://<username>.github.io/<repo>/`.

If you need to keep an older deployment that pointed at `/ (root)`, create a
redirecting `index.html` that forwards to `docs/index.html` or remove the old
source before switching the Pages configuration.
