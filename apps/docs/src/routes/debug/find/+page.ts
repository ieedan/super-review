// Client-only debug harness: it mounts the real DiffView + find controller from
// @super-review/ui against mock data. The store and find code touch `window`,
// so there's nothing to prerender or server-render here.
export const ssr = false;
export const prerender = false;
