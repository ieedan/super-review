// The hotkey types and helpers now live in @super-review/core (the shared
// `AppSettings` type in core references `Hotkeys`, so they had to move with it).
// This shim re-exports them under the existing `@shared/hotkeys` alias so the
// renderer's import sites don't change.
export * from '@super-review/core/hotkeys';
