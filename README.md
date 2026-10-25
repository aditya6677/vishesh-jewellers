# Vishesh Jewellers JSON-backed app

This server renders the supplied `index.html` unchanged in appearance and adds a JSON-backed implementation of its `window.storage` API. Catalogue entries, stock, business details, and the invoice counter are saved as readable JSON values in `data/store.json`.

## Run

From this folder:

```bash
npm start
```

Then open `http://localhost:3000`.

## Desktop app

To open it as a desktop app, install dependencies and run:

```bash
npm run desktop
```

It starts an internal local server automatically and stores JSON data in the operating system's app-data directory. To create a macOS installer, run `npm run package:desktop`; use `npm run package:windows` for a Windows installer. If the build machine supports both targets, `npm run package:all` creates both installers.

## Automatic reload during edits

Install the development dependency once, then run the watcher:

```bash
npm install
npm run dev
```

`nodemon` restarts the server when application code changes in `server.js`, `lib/`, `source/`, or the public assets. It watches JavaScript, HTML, CSS, and JSON source files. Its explicit configuration ignores the entire `data/` folder, so JSON data saves do not reload the app. On Node 18+, the dependency-free alternative is `npm run watch` (backend JavaScript only).

## Code organization and checks

See [ARCHITECTURE.md](ARCHITECTURE.md) for the route/service structure, menu file locations, browser initialization dependencies, and instructions for extending the app. Run `npm test` for automated checks using temporary encrypted test data.

## Framework migration preview

On `migration/react-fastify`, use Node 20.19+ (Node 20) or Node 22.12+, run `npm ci`, then `npm run build:frontend` and `npm start`. Open `http://localhost:3000/?frontend=react` for the React Dashboard; `/` retains the original UI. See [MIGRATION.md](MIGRATION.md) for milestones, checks, packaging, and recovery instructions.

## Code layout

- `server.js` — HTTP entry point and HTML enhancement composition.
- `lib/json-store.js` — JSON persistence, including legacy-data migration.
- `lib/stock-flow.js` — invoice-to-stock selection, validation, and weight-deduction transformation.
- `public/manifest.webmanifest` and `public/service-worker.js` — PWA installation and offline app shell.
- `assets/vishesh-jewellers-logo.png` — transparent app and invoice logo.
- `data/store.json` — runtime business data; keep this out of code changes.

The server expects the source page at `/Users/shinchan/Downloads/index.html`. To use another copy, start it with:

```bash
SOURCE_HTML="/absolute/path/to/index.html" npm start
```

Do not open the HTML file directly: run it through this server so data persists in JSON.

## Optional live gold and silver rates

The Dashboard shows a Live Market Rates card only when the app has internet access and a GoldAPI key is configured. Keep the key on the server or desktop app environment; never place it in browser code.

```bash
GOLD_API_KEY="your-key" npm start
```

Rates are shown as INR per gram and are cached for one minute. They are market spot rates, not a replacement for the shop's final selling rate.
