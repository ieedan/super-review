# @super-review/web

The marketing site **and** the licensing backend for
[Super Review](../desktop): the landing/download page plus GitHub sign-in
(better-auth), a Convex database, Stripe billing, and the desktop-facing license
API. Built with SvelteKit + Tailwind v4 (Vercel adapter); Convex functions live
in `src/lib/convex/`.

## First-time dev setup

```sh
cd apps/web

# 1. Create your Convex dev project (writes PUBLIC_CONVEX_URL into .env.local)
pnpm convex dev --once

# 2. Configure secrets, GitHub OAuth, Stripe, and the license keypair.
#    Interactive, resumable, and it prints exactly what to do at each step.
pnpm setup:dev
```

`pnpm setup:dev` generates the app secrets and the Ed25519 license-signing
keypair (writing the public half into the desktop app), then walks you through
creating a GitHub OAuth app and the Stripe products/prices/webhook, storing
everything in `.env.local` and the Convex deployment env. It is **resumable**:
re-run it any time and finished steps are skipped; pass `--fresh` to redo them.
See [`docs/LICENSING.md`](./docs/LICENSING.md) for the full reference.

## Develop

From the repo root:

```sh
pnpm dev:web                                            # Convex + SvelteKit
SUPER_REVIEW_API_URL=http://localhost:5173 pnpm dev:desktop
```

## Build

```sh
pnpm --filter @super-review/web build
```

## How downloads work

The release artifacts ship under **stable, version-less filenames** (set in
[`apps/desktop/electron-builder.yml`](../desktop/electron-builder.yml) via
`dmg.artifactName` / `nsis.artifactName`):

- macOS (Apple silicon): `Super-Review-mac-arm64.dmg`
- Windows (x64): `Super-Review-win-x64.exe`

The buttons link to `github.com/ieedan/super-review/releases/latest/download/<name>`,
which 302-redirects to the newest release's matching asset and serves it with
`Content-Disposition: attachment` — so a click **downloads the binary directly**,
always the latest, with no API call. `src/lib/releases.ts` only sniffs the OS to
pick which button leads. The version pill is a best-effort label from the API and
is purely cosmetic.

> **Note:** these stable filenames take effect on the **next** release. The
> current `v0.0.4` assets still carry version-stamped names, so the buttons 404
> until a build with `electron-builder.yml`'s `artifactName` is published (a
> changeset for this is already staged). And while `ieedan/super-review` is a
> **private** repo, the links resolve only for visitors authenticated to it.

## Waitlist, invites, and beta access

Pre-launch the app runs as a closed, invite-only beta. Three pieces:

1. **Waitlist mode** — the master switch, a row in the Convex `settings` table
   (not an env var), so flipping it takes effect immediately with **no
   redeploy**. The marketing layout SSR-loads it and upgrades it to a live
   subscription, so open tabs switch over without a reload.
2. **The waitlist** — `waitlistSignups`, just emails. Joining costs one field
   and no OAuth, and grants nothing on its own.
3. **Invite codes** — `inviteCodes`, single-use. Redeeming one is what makes a
   GitHub account a `betaMembers` row, which is what the gates check.

The code is the bridge between the two identities: someone joins with any email,
you mail them a code, and redeeming it binds the invitation to whichever GitHub
account they actually sign in with. Nothing has to match up.

### Flipping waitlist mode

From the [Convex dashboard](https://dashboard.convex.dev) → **Functions** →
`settings:setWaitlistMode` → Run `{ "enabled": true }`. Or:

```sh
pnpm --filter @super-review/web exec convex run settings:setWaitlistMode '{"enabled":true}'
```

The mutation upserts, so it works before the row exists; with no row at all the
site renders as launched.

### What waitlist mode changes

| Surface                        | Waitlist mode on                                                       |
| ------------------------------ | ---------------------------------------------------------------------- |
| Hero, homepage pricing section | Email waitlist form instead of buy CTAs                                |
| `/pricing`                     | Sign-in + beta-member gated; non-members redirect to the dashboard     |
| `/checkout/*`                  | Same membership gate (plus Stripe-side `hasBetaAccess` enforcement)    |
| Sign-in                        | Open — anyone can sign in and see the dashboard                        |
| Dashboard                      | Invite-code form for non-members; guest codes for members; no Upgrade  |
| `/api/download/*`              | Redirects non-members to the dashboard                                 |
| Desktop activation             | No trial started; app says to redeem a code first                      |

### Buying during the beta

Prices are not published pre-launch, but invited beta users still need to be
able to buy: the desktop app's **Upgrade** link goes to `/pricing`, and showing
someone a waitlist form they have already been through is a dead end.

So in waitlist mode `/pricing` is **member-gated rather than replaced**. Signed
out you get bounced to `/login?next=/pricing`; signed in without an invite you
go to the dashboard; invited members get the real plans. The homepage pricing
section stays hidden either way, since that is the surface we don't publish
prices on.

Checkout routes and the Stripe session hooks (`createLifetimeCheckout`,
`getCheckoutSessionParams`) re-check `hasBetaAccess`, so a deep link cannot
open payment for a non-invited account.

### Inviting people

Invite the next wave in signup order:

```sh
pnpm --filter @super-review/web exec convex run invites:inviteNext '{"count":25}'
```

Or one specific address (they need not be on the waitlist):

```sh
pnpm --filter @super-review/web exec convex run invites:inviteEmail '{"email":"them@example.com"}'
```

Both mint a code, mark the waitlist row invited, and email it via Loops.
`inviteEmail` is idempotent per address: an existing unredeemed code is
**resent** rather than a second one minted, so re-running a sweep never leaves
someone holding two live codes. `waitlist:pending` shows who has not been
invited yet, `invites:revokeCode` kills an unredeemed code, and
`invites:removeMember` takes someone out of the beta.

### Redeeming an invite

The invite email's button points at **`/join?code=...`**, which redeems
server-side and forwards to the dashboard. One click from the email, no form, no
flash of an intermediate state, and no dependency on client JS. Signed-out
visitors are bounced through `/login` first, carrying the code in `next`.

`/join` only ever _renders_ on failure (invalid, revoked, already-used, or rate
limited), showing the code and which account is signed in so a wrong-account
mistake is diagnosable.

Redemption binds the code permanently to whichever account is signed in, which
is why this is a distinct URL rather than something the dashboard does on load:
arriving there is an explicit act, not a side effect of visiting. If someone
redeems on the wrong account, `invites:removeMember` plus a fresh
`invites:inviteEmail` puts it right.

The dashboard keeps a manual entry field for codes that arrive by other means
(or if a mail client mangles the link). It prefills from `?code=`, falling back
to a `sessionStorage` stash written before the OAuth round trip, since
better-auth does not document preserving a query string on `callbackURL`.

### Guest codes

Redeeming a **beta** code mints 3 **guest** codes, shown on that member's
dashboard to share. Redeeming a guest code mints none. That cap is deliberate:
it keeps each wave bounded at roughly 4x, where recursive guest codes would
compound (3^n per generation) with no ceiling and no way to slow it down once
started. The constant is `GUEST_CODES_PER_MEMBER` in
[`invites.ts`](src/lib/convex/invites.ts).

Codes look like `SUPER-J6P6-B7WJ`: 8 characters over a 29-symbol alphabet with
the confusable ones (`O/0`, `I/1/L`, `U/V`) removed, since people retype them
off a phone. That is ~38 bits, and redemption is rate limited per account on top.
Redemption failures all return one error on purpose, so responses cannot be used
to map the code space.

### Referral reward

When **every** guest code a member was given has been redeemed, they earn a
permanent **15% off** at checkout. It applies to both the subscription and the
perpetual purchase, server-side, with no code for them to type (so it cannot be
shared or guessed).

It has no expiry date, and does not need one: **invite codes stop being
redeemable the moment waitlist mode is turned off**, so no new rewards can be
earned after launch. The programme closes itself.

The award lives on `betaMembers.referralRewardEarnedAt`, not on `licenses` —
a license row only exists after first activation, and the reward can be earned
before that. It is written once and never overwritten, so it cannot be earned
twice.

The denominator is _that member's own live codes_, not a hard-coded 3, so it
stays correct if `GUEST_CODES_PER_MEMBER` changes. Revoked codes are excluded,
so revoking an unused one does not permanently block the reward.

Two places must agree on the number:

- `REFERRAL_DISCOUNT_PERCENT` in [`invites.ts`](src/lib/convex/invites.ts) —
  what the dashboard and the email _advertise_.
- The Stripe coupon named by `STRIPE_REFERRAL_COUPON_ID` — what is actually
  charged. **Stripe is the source of truth.**

`pnpm setup:dev` prompts for the coupon (percentage discount, duration
**Once**). Without it the reward is still recorded and shown, it just does not
discount anything — so if you change the percentage, change it in both places.

One Stripe constraint worth remembering: `discounts` and
`allow_promotion_codes` are mutually exclusive on a Checkout session. Adding a
"have a promo code?" box later means choosing one per session, not both.

### Email (Loops)

Four transactional emails, each with its own Loops template id. Variables are
referenced in the template as `{data.x}`, not `{x}`:

| Email                  | Sent when                              | Variables                                                  |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Waitlist confirmation  | someone joins the waitlist             | `{data.waitlistUrl}`                                       |
| Invite code            | you invite someone into the beta       | `{data.code}`, `{data.redeemUrl}`                          |
| Guest invite           | a member emails a guest code to a friend | `{data.code}`, `{data.redeemUrl}`, `{data.inviterName}`  |
| Welcome (with invites) | someone redeems a **beta** code        | `{data.guestCodeCount}`, `{data.dashboardUrl}`             |
| Welcome (no invites)   | someone redeems a **guest** code       | `{data.dashboardUrl}`                                      |

There are two welcome emails because **LMX has no conditional rendering**. A beta
redeemer gets 3 guest codes and a guest redeemer gets none, so a single template
would leave the latter looking at an "invite your friends" heading with nothing
under it. `sendWelcomeEmail` picks the template by whether there are codes.

The welcome email deliberately does **not** print the guest codes. It says how
many were granted and links to the dashboard, because an email is the one copy
we cannot revoke or mask later: a forwarded message would hand someone live
invites. The dashboard shows them masked, behind the account that owns them.

The waitlist confirmation only sends when joining was the act itself (the
marketing form). Joining as a side effect of signing in stays silent, otherwise
someone who signs in and is invited minutes later gets "we'll email you when a
spot opens up" immediately followed by "you're in".

Both one-shot emails are naturally deduped by the mutations that trigger them:
`waitlist.join` returns early for an address already on the list, and
`invites.redeem` returns early for an existing member, so neither can be made to
fire twice for the same person.

`pnpm setup:dev` has a Loops step that prompts for the API key and all four
template ids, validates the key against Loops before storing it, and writes them
to the Convex deployment env. It is skippable and resumable per value: anything
already set is left alone, so re-running only asks for what is missing.

Set them by hand instead with `npx convex env set`. All live in the **Convex**
deployment env, not the SvelteKit `.env`. The templates live in Loops so their
copy, sender, and design change without a deploy; this side only supplies the
data variables above.

Each email is independent. **An unset template id means that one email is logged
to the Convex console instead of sent** (including anything hard to recover, like
an invite code or guest codes), so local dev needs no Loops account and a
half-configured Loops does not block the rest.

Every Loops call is best-effort and runs as a scheduled action _after_ the
database write commits, because the signup, invite, or membership is already
real by then. A failure logs loudly and is swallowed rather than retried.

Waitlist signups are also mirrored into the Loops audience via update-or-create,
so the list is broadcastable from there without a manual export.

### Two deliberate escape hatches

`hasBetaAccess` in [`waitlist.ts`](src/lib/convex/waitlist.ts) is the single
place the decision is made, and it always allows when:

- **waitlist mode is off** — so the gate is completely inert after launch, and
  turning the flag off can never leave someone stranded; and
- **the account already has a plan** — a paying, perpetual, or mid-trial license
  is never revoked by the gate. Access is only ever withheld from accounts that
  have nothing yet.

Both branches are verified: turning waitlist mode on does not lock out a paying
customer who was never invited.

## Naming: "Perpetual", not "Lifetime"

The one-time purchase is called **Perpetual** everywhere a user can see it: the
pricing card, the licence card badge, the dashboard, error messages, and the
Loops emails. The Stripe product is "Super Review Perpetual".

The stored value is still `plan: 'lifetime'` - a schema enum, a Stripe metadata
key, and a claim inside signed licence tokens. Renaming it would mean a data
migration and re-signing live tokens for no user-visible gain, so internals say
`lifetime` and the UI says Perpetual. Identifiers like `createLifetimeCheckout`
and the `/checkout/lifetime` route follow the stored value on purpose.
