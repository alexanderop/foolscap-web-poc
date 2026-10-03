# Foolscap web proof of concept

This is a separate Vue/Vite experiment, not the main Foolscap Electron application.

- `src`: browser UI and CodeMirror. CodeMirror owns text, selection and undo.
- `companion`: loopback HTTP server, folder-contained file authority, pairing and local Codex process.
- `desktop`: native folder selection, browser approval, local sign-in and companion lifecycle.
- `api`: optional hosted rewrite endpoint with server-only credentials and durable quotas.
- `shared`: Zod transport schemas. Never expose commands, credentials, or arbitrary paths to the page.
- `tests`: connected Node tests, Chromium journeys, native and packaged/live boundary checks.

Run `pnpm verify` before handing off changes. Run `pnpm test:connect` for native changes. Package and run `pnpm test:hosted` for bundled agent changes; this uses real local provider authentication and consumes usage. Do not overlap companion tests on the fixed loopback port. Distinguish controlled native approval/permissions from manual OS interaction, fixtures from real inference, unsigned previews from signed releases.

Preserve explicit native approval, signed challenge pairing, exact origin allowlists, loopback binding, folder containment, revision checks, cancellation, and stale-proposal rejection. Session tokens belong in memory only. Browser private keys must be nonextractable. Hosted inference must fail closed without quota checks. Do not commit tokens, local paths, credentials, generated packages, test artifacts, or `.vercel`.
