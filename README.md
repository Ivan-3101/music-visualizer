# Music Visualizer

A 3D music visualizer that runs in the browser, built with TypeScript, Vite and Three.js.

Work in progress. See [docs/DESIGN.md](docs/DESIGN.md) for the design and roadmap.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server with live reload |
| `npm run build` | Type-check, then build the production site into `dist/` |
| `npm run preview` | Serve the `dist/` build locally |
