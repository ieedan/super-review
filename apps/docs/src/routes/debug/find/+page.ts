// Client-only debug harness: it mounts the real DiffView + find controller from
// @super-review/ui against mock data. The store and find code touch `window`,
// so it can't be server-rendered — but it CAN be prerendered as an empty shell
// that hydrates in the browser, which keeps the whole site static.
export const ssr = false;
export const prerender = true;
