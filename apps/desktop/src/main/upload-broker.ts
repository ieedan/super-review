// Shared client for the R2 upload broker (the Cloudflare Worker in
// infra/feedback-uploader). Both the feedback dialog's attachments and the
// markdown composers' image paste/drop go through here, so every remote upload
// hits the same rate-limited, quota'd, size-checked endpoint.
import { FEEDBACK_IMAGE_TYPES, FEEDBACK_MAX_IMAGE_BYTES } from '@shared/types.js';

// URL of the broker. Defaults to the project's deployed Worker so released builds
// get uploads with no configuration; an env var overrides it for forks/self-host.
// Set the env var to an empty string to disable uploads. A trailing slash is
// tolerated. Mirrors the SUPER_REVIEW_GH_CLIENT_ID default pattern.
const DEFAULT_UPLOAD_URL = 'https://super-review-feedback-uploader.aidanbleser35.workers.dev';
export const UPLOAD_URL = (
	process.env.SUPER_REVIEW_FEEDBACK_UPLOAD_URL ?? DEFAULT_UPLOAD_URL
).replace(/\/+$/, '');

export function isUploadConfigured(): boolean {
	return !!UPLOAD_URL;
}

const IMAGE_TYPES = new Set<string>(FEEDBACK_IMAGE_TYPES);

export function isImageType(mimeType: string): boolean {
	return IMAGE_TYPES.has(mimeType);
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// POST one file to the broker, authenticated as `token` (the user's GitHub
// token, which the broker verifies). Returns the hosted URL.
export async function uploadToBroker(
	file: { name: string; mimeType: string; bytes: Uint8Array },
	token: string
): Promise<string> {
	if (!UPLOAD_URL) throw new Error('Attachment uploads are not configured.');
	// Copy into a fresh ArrayBuffer so a SharedArrayBuffer-backed view (or a
	// partial view over a larger buffer) is sent as exactly these bytes.
	const body = file.bytes.slice().buffer;
	const res = await fetch(`${UPLOAD_URL}/upload`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': file.mimeType,
			'X-Filename': encodeURIComponent(file.name)
		},
		body
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(
			`Upload failed for "${file.name}" (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`
		);
	}
	const data = (await res.json()) as { url?: string };
	if (!data.url) throw new Error(`Upload of "${file.name}" returned no URL.`);
	return data.url;
}

// Validate that an image is an allowed type and within the per-image size cap.
// Throws a user-facing message otherwise. Shared by the feedback and markdown
// paths so the rules stay identical.
export function validateImage(file: { name: string; mimeType: string; bytes: Uint8Array }): void {
	if (!isImageType(file.mimeType)) {
		throw new Error(`"${file.name}" isn't a supported image type (${file.mimeType}).`);
	}
	if (file.bytes.byteLength > FEEDBACK_MAX_IMAGE_BYTES) {
		throw new Error(
			`"${file.name}" is too large (${formatBytes(file.bytes.byteLength)}). Images must be ` +
				`${formatBytes(FEEDBACK_MAX_IMAGE_BYTES)} or smaller.`
		);
	}
}
