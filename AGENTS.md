# Foolscap web proof of concept

This is a separate Vue/Vite experiment, not the Electron application.

- `src`: browser UI and CodeMirror. CodeMirror owns text, selection and undo.
- `companion`: loopback HTTP server, single-file access, local Codex child process.
- `shared`: Zod transport schemas. Never expose commands, credentials, or arbitrary paths to the page.
- `tests`: Node integration tests for the real companion, Chromium journeys for editor behavior.

Run `pnpm verify` before handing off changes. Live Codex and hosted-to-local verification are separate from deterministic tests. Never label the scripted demo or fixture provider as real AI.

Preserve explicit pairing, exact origin allowlists, loopback binding, revision checks, cancellation, and safe stale-proposal rejection. Tokens belong in tab memory only. Do not commit tokens, local paths, credentials, test artifacts, or `.vercel`.
