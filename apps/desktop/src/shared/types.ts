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
	DEFAULT_HEADER_ITEMS,
	EDITORS_BY_PLATFORM,
	FEEDBACK_IMAGE_TYPES,
	FEEDBACK_MAX_FILES,
	FEEDBACK_MAX_IMAGE_BYTES,
	FEEDBACK_MAX_TOTAL_BYTES,
	FEEDBACK_MAX_VIDEO_BYTES,
	FEEDBACK_REPO,
	FEEDBACK_VIDEO_TYPES,
	LOCAL_ATTACHMENT_SCHEME,
	TERMINALS_BY_PLATFORM,
	WINDOW_BOUNDS
} from '@super-review/core/types';
