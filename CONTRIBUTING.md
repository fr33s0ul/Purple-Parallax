# Contributing to Purple-Parallax (Cybersecurity Atlas)

Thank you for helping extend the Cybersecurity Atlas! This project stays intentionally lightweight so the community can collaborate through familiar GitHub workflows.

## Quick start: edit the dataset

1. **Fork and branch** – create your fork, then open a feature branch.
2. **Edit the atlas data** – update `docs/data/atlas.json`. Use two-space indentation and keep entries alphabetised within their parent when possible.
3. **Install tooling once (optional)** – from the repository root run:
   ```bash
   npm install
   ```
   The validator downloads automatically during the next step, but this command warms the local cache for faster repeats.
4. **Validate locally** – ensure your edits match the schema:
   ```bash
   npm run validate-dataset
   ```
   The command uses [AJV](https://ajv.js.org/) via `npm exec` to check `docs/data/atlas.json` against `schema/atlas.schema.json`. Fix any reported issues before submitting. The CLI is downloaded from npm on demand, so the first run requires an internet connection.
5. **Open a pull request** – push your branch and open a PR. The "Validate dataset" GitHub Action will re-run the schema check and block merges until it passes. Include a short summary of the topics you added or changed.

### Field reference

The atlas JSON is a recursive tree. Each node supports the following properties:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string (required) | Display name for the node. |
| `summary` | string | Short description used in detail panels. |
| `description` | string | Longer free-form text. |
| `aka` | array of strings | Alternative names or abbreviations. |
| `tags` | array of strings | Additional keywords for search/filtering. |
| `links` | array of objects | Each link must include `title` and `url`. |
| `relationships` | array of objects | Optional cross-links with `targetId` and `kind`. |
| `syntheticOverview` | boolean | Marks synthetic aggregation nodes. |
| `lazyChildUrl` | string (URL) | Reserved for large subtrees loaded on demand. |
| `children` | array of nodes | Recursively nested children. |

Only `name` is required today, but adding tags, summaries, and links improves discoverability.

## Option 2 (future): sheet-driven workflow

If the dataset ever outgrows manual JSON editing, we can introduce a light conversion script:

1. Store the canonical data in a spreadsheet (CSV or Google Sheet).
2. Add `tools/build-dataset.js` to transform the sheet export into the normalized JSON consumed by the app.
3. Optionally schedule a GitHub Action to rebuild `docs/data/atlas.json` on a cadence or when the sheet changes.

This approach empowers non-technical editors to collaborate in a shared sheet while keeping code reviews focused on the generated JSON diff. We are not implementing it yet, but documenting the path keeps the door open.

## Accessibility and UX checks

When you introduce new UI controls or content, verify keyboard focus, colour contrast (light and dark themes), and aria-live updates for loader changes. The existing layout uses semantic HTML to keep these checks lightweight.
