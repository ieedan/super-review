// Shared Carta instance powering the GitHub-style markdown editor used when
// writing PR review comments (see MarkdownComposer.svelte). A single instance is
// created once and reused by every composer — Carta is designed to be shared,
// and this avoids re-instantiating Shiki + the plugins on every comment box.
//
// Plugins mirror GitHub's comment editor experience:
//   - code:       Shiki syntax highlighting in the preview pane
//   - emoji:      `:emoji:` autocomplete picker
//   - slash:      `/` command menu for inserting markdown snippets
//   - attachment: paste/drop/click image upload to the R2 broker
//
// `attachment` was previously omitted for lack of an upload endpoint; the feedback
// broker (see infra/feedback-uploader) now provides one. Every Carta composer is
// GitHub-bound (PR comments, changeset summaries), so a single remote upload
// function serves them all — no per-composer routing needed. Local-only review
// comments use a plain textarea + the markdown-image-upload util instead, since
// they save to disk rather than uploading.
import { Carta } from 'carta-md';
import { code } from '@cartamd/plugin-code';
import { emoji } from '@cartamd/plugin-emoji';
import { slash } from '@cartamd/plugin-slash';
import { attachment } from '@cartamd/plugin-attachment';
import { FEEDBACK_IMAGE_TYPES } from '@shared/types';
import { setError } from '$lib/store.svelte';
import DOMPurify from 'dompurify';

// Force links rendered in the preview to open in a new context and never let a
// `javascript:` URL slip through — same hardening applied in markdown.ts. The
// hook is registered globally on DOMPurify, so registering it here is harmless
// even if markdown.ts also adds it (DOMPurify de-dupes identical hooks by ref,
// and this is a separate closure that simply runs the same safe mutation).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A' && node.getAttribute('href')) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

// Keep local-attachment image URLs (sr-asset://) through sanitization so a
// pasted local image renders in the preview. The scheme is served read-only by
// the main process from the repo's attachments dir (see attachments-service).
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
	if (data.attrName === 'src' && data.attrValue.startsWith('sr-asset://')) {
		data.forceKeepAttr = true;
	}
});

export const carta = new Carta({
	// Carta operates on raw markdown and injects the result via {@html}; sanitize
	// before it reaches the DOM. The app already ships DOMPurify (see markdown.ts)
	// and treats sanitization as non-negotiable.
	sanitizer: (html) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }),
	// Dual Shiki theme so the preview's code blocks track light/dark mode. The
	// `html.dark` selector in carta-theme.css flips to the dark variant.
	theme: { light: 'github-light', dark: 'github-dark' },
	// Pass the same dual theme to the code plugin explicitly. It otherwise
	// inherits the instance theme, but being explicit keeps the preview's fenced
	// code blocks on the identical light/dark pair as the editor.
	extensions: [
		code({ theme: { light: 'github-light', dark: 'github-dark' } }),
		emoji(),
		slash(),
		attachment({
			// Restrict to the broker's accepted image types (the plugin's default set
			// includes svg/avif, which the broker rejects). Videos aren't pasted into
			// comments; the feedback dialog handles those via its explicit dropzone.
			supportedMimeTypes: [...FEEDBACK_IMAGE_TYPES],
			// Upload to the R2 broker and return the hosted URL. The plugin inserts an
			// uploading placeholder and swaps in `![](url)` on success; returning null
			// removes the placeholder. It doesn't surface errors, so we do.
			async upload(file) {
				try {
					const bytes = new Uint8Array(await file.arrayBuffer());
					return await window.api.uploads.uploadImage({
						name: file.name,
						mimeType: file.type,
						bytes
					});
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
					return null;
				}
			}
		})
	]
});

// CSS class Carta applies to the editor and the plugin popups when we pass
// `theme="github"` to <MarkdownEditor>. Kept here so the component and the
// stylesheet agree on the name.
export const CARTA_THEME = 'github';
