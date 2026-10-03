# Verification — 2026-10-03

Production: https://foolscap-web-poc.vercel.app

## Deterministic checks

`pnpm verify` passed: lint, formatting, strict browser/server TypeScript checks, production build, nine Node tests and seven Chromium journeys.

Node coverage includes real HTTP and temporary-file save/reopen, stale saves, origin validation, cancellation, signed pairing challenge/replay/revocation, folder containment, and hosted provider/quota fixtures. Chromium covers inline accept/reject/undo, stale proposals, fixture-provider save/reopen, narrow viewport, draft recovery, token-free reconnection, and opening/downloading a file without the companion.

`pnpm test:connect` passed against the built Electron companion. It exercises folder choice, native approval, remembered browser identity, real HTTP file save, and revocation. Native dialog responses are controlled by the test. It does not prove a person completed a macOS permission dialog or fresh provider sign-in.

## Packaged and live checks

The earlier CLI-based POC was verified against production with a real local Codex rewrite and exact disk-byte comparison. That evidence used manual token pairing and does not establish the new desktop onboarding.

The updated `pnpm test:hosted` scenario launches the packaged Apple Silicon companion with a disposable folder/profile, connects from the production HTTPS page in installed Chrome, invokes its bundled Codex, reviews and saves a real rewrite, checks exact disk bytes, and reconnects after reload. Native folder/approval dialogs are controlled and the normal browser local-network permission is granted by Playwright. It uses existing local provider authentication and consumes real usage.

Run the live scenario only after packaging and deploying the matching UI. Reports and screenshots are saved under ignored `artifacts/browser`. Do not run companion scenarios concurrently because they bind the same loopback port.

## Release limits

The Mac preview is unsigned and not notarized. No warning-free download/install journey, fresh OAuth login, Intel runtime, Windows/Linux build, Safari/Firefox/mobile behavior, or manual browser permission interaction is claimed.

Hosted AI remains disabled: production has no configured provider credentials or Redis quotas. Its fixture tests are not evidence of live hosted inference. The page keeps the scripted demo clearly labelled and offers real AI through the local companion.

The main browser bundle is about 752 KB uncompressed / 260 KB gzip. Draft recovery uses this browser's local storage; it is not a substitute for saving or downloading important files.
