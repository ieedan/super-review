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
client-side (see `packages/core/src/types.ts`).

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

Set the Worker URL on the environment the desktop app runs in:

```bash
SUPER_REVIEW_FEEDBACK_UPLOAD_URL="https://super-review-feedback-uploader.<account>.workers.dev"
```

When that variable is unset the feedback dialog still works for text-only issues;
the image/video dropzone is disabled and says so.
