// Remote image uploads for the markdown composers (PR comments, changeset
// summaries, feedback). Thin wrapper over the shared broker that resolves the
// signed-in account's token and validates the image before sending — so every
// composer's upload is metered by the broker's rate limit + per-user quota.
import type { ImageUploadInput } from '@shared/types.js';
import { getActiveAccountToken } from './github-service.js';
import { isUploadConfigured, uploadToBroker, validateImage } from './upload-broker.js';

export async function uploadImage(input: ImageUploadInput): Promise<string> {
	if (!isUploadConfigured()) {
		throw new Error('Image uploads are not configured for this build.');
	}
	const token = getActiveAccountToken();
	if (!token) throw new Error('Sign in to GitHub to upload images.');
	validateImage(input);
	return uploadToBroker(input, token);
}
