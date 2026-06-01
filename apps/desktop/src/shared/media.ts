// Image-file helpers shared by the main process (which reads the bytes off
// disk / out of git and encodes them) and the renderer (which decides whether
// to show the side-by-side image view and a code/image toggle).
//
// Two flavours of image matter here:
//   - Raster images (png, jpg, gif, …) are *binary* — there's no source to
//     diff, so we only ever show them side by side.
//   - SVGs are *text* — they have a readable source diff AND a rendered form,
//     so they get a Markdown-style "Code / Preview" toggle.

// Lowercased extension (no leading dot) → MIME type, for every image kind we
// know how to render in an <img>. SVG is included; it's special-cased as a
// readable format elsewhere via `isSvgPath`.
const IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	svg: 'image/svg+xml'
};

function extensionOf(filePath: string): string {
	const dot = filePath.lastIndexOf('.');
	if (dot === -1) return '';
	return filePath.slice(dot + 1).toLowerCase();
}

/** MIME type for a renderable image path, or null when it isn't one we know. */
export function imageMimeForPath(filePath: string): string | null {
	return IMAGE_MIME[extensionOf(filePath)] ?? null;
}

/** True when the path is an image we can render in an <img> (incl. SVG). */
export function isImagePath(filePath: string): boolean {
	return imageMimeForPath(filePath) !== null;
}

/**
 * True for SVGs — images stored as text, so they have both a source diff and a
 * rendered preview (unlike binary rasters, which only show side by side).
 */
export function isSvgPath(filePath: string): boolean {
	return extensionOf(filePath) === 'svg';
}
