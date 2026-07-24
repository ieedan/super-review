// The settings defaults, in a module with no Convex imports so the Convex
// functions and the browser bundle can both read them. One literal, so a gate
// on the server and a CTA in the header can never disagree about what an
// unconfigured deployment means.

/**
 * What every gate assumes when the `settings` row does not exist yet, or when
 * the query for it fails.
 *
 * Closed, deliberately. A deployment with no row is one nobody has configured:
 * a fresh preview branch, a re-provisioned production, a wiped dev database.
 * Defaulting those to launched would quietly publish prices, downloads, and
 * checkout to whoever found the URL, and the only signal would be someone
 * noticing. Opening access is a decision, so it takes an explicit
 * `settings:setWaitlistMode { enabled: false }`; the fallback never makes it.
 */
export const WAITLIST_MODE_DEFAULT = true;
