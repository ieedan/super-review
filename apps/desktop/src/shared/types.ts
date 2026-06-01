// The shared session/repo/settings types now live in @super-review/core, the
// single source of truth shared with the standalone CLI. This shim re-exports
// them under the existing `@shared/types` alias so the app's import sites don't
// change. (Importing the dedicated `/types` subpath keeps the node-only git and
// session modules out of the renderer bundle.)
export * from '@super-review/core/types';
