// The diff-defer helpers now live in @super-review/core. This shim re-exports
// them under the existing `@shared/diff-defer` alias so the main process's
// import sites don't change. (diff-context, diff-staging, and session-manifest
// also moved to core, but are consumed directly via @super-review/core/* by the
// renderer UI package and no longer need a `@shared` shim here.)
export * from '@super-review/core/diff-defer';
