// Types for the `superforms-zod4-adapter` alias (see vite.config.ts). It maps to
// sveltekit-superforms' zod4 adapter file, whose exports are named `zod`/`zodClient`
// (the barrel re-exports them as `zod4`/`zod4Client`).
declare module 'superforms-zod4-adapter' {
	export { zod4 as zod, zod4Client as zodClient } from 'sveltekit-superforms/adapters';
}
