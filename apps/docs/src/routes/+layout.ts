// Fully static marketing site. Prerender every route to plain HTML so it can be
// hosted anywhere (GitHub Pages, a CDN, object storage). Download links resolve
// the latest release on the client at runtime, so there's no server needed.
export const prerender = true;
export const ssr = true;
