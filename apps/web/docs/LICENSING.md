# Licensing setup reference

The interactive `pnpm setup:dev` handles all of this for you (and is resumable).
This document is the reference for what it configures, so you can verify or do it
by hand.

## Prerequisites

- Node >= 24, pnpm.
- A Convex account (`pnpm convex dev --once` from `apps/web` creates the dev
  deployment and writes `CONVEX_DEPLOYMENT` + `PUBLIC_CONVEX_URL` into
  `.env.local`).
- A GitHub account (for an OAuth app) and a Stripe account (test mode).
- Optional: the Stripe CLI, only to _simulate_ refunds/disputes locally.

## Environment variables

Two homes. The shared ones (`FUNCTION_SECRET`, `IP_HASH_SALT`, `LAUNCH_CUTOFF`)
must be identical in both.

### SvelteKit process — `apps/web/.env.local`

| Var                                      | Source                                                    |
| ---------------------------------------- | --------------------------------------------------------- |
| `CONVEX_DEPLOYMENT`, `PUBLIC_CONVEX_URL` | written by `convex dev`                                   |
| `PUBLIC_CONVEX_SITE_URL`                 | `PUBLIC_CONVEX_URL` with `.convex.cloud` → `.convex.site` |
| `FUNCTION_SECRET`                        | generated (shared with Convex)                            |
| `IP_HASH_SALT`                           | generated (shared with Convex)                            |
| `LAUNCH_CUTOFF`                          | chosen ISO instant (shared with Convex)                   |
| `ED25519_PRIVATE_KEY`, `ED25519_KID`     | generated keypair (private half)                          |

### Convex deployment — `pnpm convex env set ...`

| Var                                          | Source                                    |
| -------------------------------------------- | ----------------------------------------- |
| `FUNCTION_SECRET`, `IP_HASH_SALT`            | same values as `.env.local`               |
| `LAUNCH_CUTOFF`                              | same value as `.env.local`                |
| `BETTER_AUTH_SECRET`                         | generated                                 |
| `SITE_URL`                                   | web origin (dev: `http://localhost:5173`) |
| `TRIAL_DAYS`                                 | trial length (default 7)                  |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`   | GitHub OAuth app                          |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe                                    |
| `STRIPE_PRICE_LIFETIME`                      | Stripe price (standing)                   |
| `STRIPE_PRICE_LAUNCH`                        | Stripe price (launch discount)            |

The generated Ed25519 **public** key is written into
`apps/desktop/src/main/license/public-key.ts` (keyed by `ED25519_KID`) so the
desktop app can verify tokens this deployment signs.

## GitHub OAuth app

Create at <https://github.com/settings/applications/new>:

- **Homepage URL**: your `SITE_URL` (dev: `http://localhost:5173`)
- **Authorization callback URL**: `<SITE_URL>/api/auth/callback/github`

Copy the Client ID and a generated client secret.

## Stripe

Use **Test mode**.

### Product & prices (2 prices, 1 product)

Super Review sells exactly one thing: the perpetual license. There are no
subscriptions. It has two prices, and which one checkout uses is decided
server-side by `LAUNCH_CUTOFF`.

- Product **"Super Review Perpetual"** with two one-time prices:
  - $59.99 USD one-time → `STRIPE_PRICE_LIFETIME` (the standing price)
  - $39.99 USD one-time → `STRIPE_PRICE_LAUNCH` (charged until `LAUNCH_CUTOFF`)

Copy each price's API ID (`price_...`).

Two prices rather than a coupon on one price: Stripe Checkout accepts at most one
entry in `discounts`, and the referral reward already claims it. Swapping the
price id leaves that slot free, so a referred buyer gets 15% off the launch price
instead of having to pick one offer or the other.

### The launch window

`LAUNCH_CUTOFF` is the **exclusive** instant the launch price ends — at that
moment checkout reverts to `STRIPE_PRICE_LIFETIME`. A bare date is UTC midnight,
so to run the discount _through_ 31 August you set `2026-09-01`.

Both halves fail **closed**: an unset or unparseable cutoff, or an unset
`STRIPE_PRICE_LAUNCH`, means everyone pays the standing price. A missing env var
should overcharge and be noticed, not quietly discount every sale.

The pricing card reads `PUBLIC_LAUNCH_CUTOFF` to show the offer, and derives the
"through <date>" line from the same value, so the card cannot advertise a day on
which checkout has already reverted. `createLifetimeCheckout` resolves the price
itself, so a stale page cannot buy at the old price after the window shuts.

### Webhook

Create a dashboard webhook (Developers → Webhooks) at
`https://<deployment>.convex.site/api/auth/stripe/webhook` with exactly these 3
events, and copy its signing secret (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`:

- `checkout.session.completed`
- `charge.refunded`
- `charge.dispute.created`

This applies to dev too, not just production. A Convex dev deployment serves its
HTTP actions from the cloud whether or not `convex dev` is running locally, so
Stripe can deliver to it around the clock, retry failed deliveries for 3 days,
and give you a delivery log with response codes. Nothing has to be running on
your machine for a webhook to land.

Each developer points their own dashboard endpoint at their own deployment URL,
so the endpoint URL is never shared or committed.

To change just the webhook secret later (after rotating it, or after switching
away from `stripe listen`), re-run the Stripe step on its own:

```sh
pnpm setup:dev --only stripe
```

Prefer that over `--fresh`, which re-runs every step including the license
keypair — regenerating it rewrites the desktop's embedded public key and
invalidates every token already issued.

> **Do not also run `stripe listen`.** The webhook secret must match whoever
> signs the event, and `STRIPE_WEBHOOK_SECRET` holds exactly one secret. A
> dashboard endpoint signs with its own secret; `stripe listen` signs with the
> CLI's. Running both delivers every event twice and the copy signed with the
> other secret fails with _"No signatures found matching the expected
> signature"_. `apps/web/scripts/stripe-listen.mjs` is kept only as a manual
> escape hatch for when no dashboard endpoint exists.

`checkout.session.completed` carries the perpetual purchase (matched by
`metadata.kind`); the two `charge.*` events suspend a license on
refund/chargeback.

### API key

Copy the test **Secret key** (`sk_test_...`) → `STRIPE_SECRET_KEY`.

## Running & testing

Start everything with the [bizi](https://getbizi.dev) task runner (its `dev`
group runs the web app and the desktop app together):

```sh
bizi
```

Or run them individually:

```sh
pnpm dev:web                                            # Convex + SvelteKit
SUPER_REVIEW_API_URL=http://localhost:5173 pnpm dev:desktop
```

Stripe webhooks arrive at the Convex deployment directly, so there is no
listener to start.

- The desktop app opens to the activation screen and shows a short code (like
  `WXYZ-4K7M`). It also opens the browser to `/activate`.
- Sign in with GitHub if prompted, type the code into the OTP field, and click
  **Approve** (or **Deny**). The desktop polls in the background and unlocks as
  soon as you approve. No `super-review://` deep link is involved, so this works
  on macOS dev the same as everywhere else.
- First activation starts the 7-day trial and unlocks the app.
- Pay with test card `4242 4242 4242 4242` (any future expiry / CVC / ZIP).
- Simulate refund/chargeback (the events are delivered by the dashboard
  endpoint, so nothing extra needs to be running):
  ```sh
  stripe trigger charge.refunded
  stripe trigger charge.dispute.created
  ```

## Go/no-go to verify early

Run `stripe trigger checkout.session.completed` against the dev deployment and
confirm the webhook processes without error in the Convex logs. If the Stripe
plugin's webhook crypto misbehaves in the Convex runtime, fall back to a plain
Stripe webhook `httpAction` (the `licenses` schema does not change).
