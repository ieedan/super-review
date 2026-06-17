// The shared session/repo/settings types now live in @super-review/core, the
// single source of truth shared with the standalone CLI. This shim re-exports
// them under the existing `@shared/types` alias so the app's import sites don't
// change. (Importing the dedicated `/types` subpath keeps the node-only git and
// session modules out of the renderer bundle.)
//
// The type surface is re-exported type-only so it's erased at build and never
// becomes a runtime edge the Vite dep scanner has to crawl into this workspace-
// source package. Only the handful of runtime constants need a real re-export.
export type * from '@super-review/core/types';
export {
	EDITORS_BY_PLATFORM,
	TERMINALS_BY_PLATFORM,
	WINDOW_BOUNDS
} from '@super-review/core/types';
