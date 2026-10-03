# Foolscap Web POC

[**Open the writing room**](https://foolscap-web-poc.vercel.app) · [Mac preview downloads](https://github.com/alexanderop/foolscap-web-poc/releases/tag/v0.2.0) · [Verification](docs/verification.md)

A Vue + Vite + CodeMirror experiment: a website with inline edit review, local files, and a local writing agent.

## Start writing

Open the website and choose **Start writing**. No account or installation is required. Drafts recover after a reload in this browser. **Open file** opens a file from your computer; supporting browsers can save back to that file, while others download an edited copy. Download important drafts as a backup.

The guided demo is scripted and clearly labelled. Real online AI is disabled until server credentials and usage limits are configured.

## Connect your computer

Foolscap Connect is a small desktop companion that bundles Codex. No repository clone, package manager, terminal, or copied pairing token is needed.

1. Download the Apple Silicon Mac preview and open Foolscap Connect.
2. Choose your writing folder in its native folder picker.
3. Choose **Sign in** if needed and complete the agent provider's browser sign-in.
4. Open the writing room, choose **Connect your computer**, then **Connect this browser**. Approve the native connection prompt and your browser's local-network permission.
5. Open a file, select a passage, ask for an edit, and accept or reject the inline suggestion. **Save file** writes the accepted text back to disk.

The companion remembers approved browsers. A reload reconnects while it is running. **Disconnect all browsers** revokes access. Start-at-login is optional. Closing the companion window leaves it running; use its Quit button to stop it.

**Release limitation:** the Mac preview is unsigned and not notarized. It is a technical preview, not yet a warning-free installer suitable for general nontechnical distribution. Apple signing and notarization are required to finish that experience. Windows, Linux, Safari, Firefox, and mobile access are not qualified.

## Boundaries

- Vercel serves the editor. The companion listens only on loopback, checks exact origins and Host, and exposes only Markdown/text files inside the folder selected in the native app.
- Browser pairing uses a nonextractable private key in IndexedDB, a fresh signed challenge, and explicit native approval. Short-lived session tokens stay in memory. The companion stores public-key fingerprints, not browser private keys.
- Files use opaque IDs, real-path containment checks, bounded sizes, and revision-checked saves. Symlinks are excluded. Temporary-file replacement preserves complete writes, but is not a portable atomic compare-and-swap against a concurrent external writer.
- Codex runs locally with local authentication; inference still uses its provider. Selected text and instructions go to that provider. It runs in a temporary directory with a read-only sandbox and structured output. Prompt instructions are not a tool-security boundary.
- Changes invalidate stale proposals. Acceptance uses CodeMirror undo history. Cancellation terminates the owned agent process group. The website cannot select executables or arbitrary paths.
- Online AI, when configured, sends selected text and instructions through the Vercel endpoint to OpenAI. The UI distinguishes it from local-agent mode.

## Develop

Requires Node 22.13+ or 24.x and pnpm 10.28.2.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm exec playwright install chromium
pnpm verify
```

The editor runs at http://127.0.0.1:5197. Browser tests use a fixture provider. The desktop companion allows the production website origin; it does not broadly trust development origins.

```sh
pnpm connect:dev
pnpm test:connect
pnpm connect:package
```

The build downloads pinned official Codex 0.160.0 binaries and their license. `connect:package` expects Apple signing credentials and notarization configuration. The published preview is built with explicit signing/notarization overrides. Set `CONNECT_ARCH=x64` before `connect:build` and select `--x64` in electron-builder to build Intel artifacts. Only architectures explicitly recorded in verification have runtime evidence.

## Hosted AI configuration

Deploy with Vercel's Vite integration. The `/api/hosted` function is disabled unless all these environment variables exist:

- `HOSTED_AI_ENABLED=true`
- `OPENAI_API_KEY` and `OPENAI_MODEL`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

`APP_ORIGIN` defaults to the production URL. Never use `VITE_` variables for secrets. Durable Redis counters limit requests to 10 per IP per day and 100 total per day; failure to check quota denies the request. These are preview abuse controls, not an account/billing system. Select a model supporting structured outputs. Provider credentials are never sent to the browser.

The optional hosted endpoint has fixture coverage; real hosted inference is not enabled or verified in this deployment.

## References

- [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Chrome local-network access](https://developer.chrome.com/blog/local-network-access)
- [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
