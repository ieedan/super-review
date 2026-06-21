# Feedback uploader (Cloudflare Worker)

Stores screenshots / screen recordings attached to in-app feedback in an R2
bucket and returns a public URL that the desktop app embeds in the GitHub issue
it files. GitHub's REST API can't attach media to an issue, so the app uploads
here first.

This Worker is **deployed separately** from the desktop app and is intentionally
outside the pnpm workspace (so it has no effect on the app's lockfile or CI).

## How it works

- `POST /upload` with `Authorization: Bearer <github token>`, the file's
  `Content-Type`, and the raw bytes as the body. The Worker verifies the token by
  calling GitHub's `/user` endpoint (identity check only — the token is never
  stored), enforces the type/size limits, writes the object to R2, and returns
  `{ "url": "..." }`.
- `GET /feedback/<key>` serves a stored object, so it works even before you put a
  custom domain in front of the bucket.

Limits (per file): images ≤ 10 MB, videos ≤ 50 MB. Allowed types: PNG, JPEG,
GIF, WebP, MP4, WebM, QuickTime. These mirror the caps the desktop app enforces
client-side (see `packages/core/src/types.ts`). The size cap is enforced by
reading the body as a stream and aborting the moment it's exceeded, so a client
can't bypass it by omitting/spoofing `Content-Length`.

Uploads are rate-limited per source IP (30/min by default, see `[[ratelimit]]`
in `wrangler.toml`) — and the limit is checked *before* the GitHub token is
verified, so a flood of bogus tokens can't amplify into a GitHub request each.
The limiter is created automatically on `wrangler deploy`; no separate resource
to provision. Reads (`GET /feedback/*`) are intentionally not IP-limited because
GitHub's image proxy serves all viewers from a few shared IPs.

## Setup

```bash
cd infra/feedback-uploader
pnpm install            # or npm install

# 1. Create the bucket (one time)
pnpm wrangler r2 bucket create super-review-feedback

# 2. (optional) enable public access / a custom domain on the bucket, then set
#    PUBLIC_BASE_URL in wrangler.toml to that origin.

# 3. Deploy
pnpm deploy
```

`wrangler deploy` prints the Worker's URL (e.g.
`https://super-review-feedback-uploader.<account>.workers.dev`).

## Wiring it to the desktop app

The desktop app ships with the project's deployed broker URL baked in as the
default (`DEFAULT_UPLOAD_URL` in `apps/desktop/src/main/feedback-service.ts`), so
released builds get media uploads with no configuration.

To point a fork/self-host at a different broker, override it via env:

```bash
SUPER_REVIEW_FEEDBACK_UPLOAD_URL="https://super-review-feedback-uploader.<account>.workers.dev"
```

Set the variable to an empty string to disable uploads entirely — the feedback
dialog then files text-only issues and the dropzone is hidden with a note.
