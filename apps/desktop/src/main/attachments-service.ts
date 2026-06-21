// Local image attachments for local-only review comments. Instead of uploading
// to the network, the image is written into the repo's git-ignored
// `.super-review/attachments` dir and referenced by an `sr-asset://` URL that the
// main process serves read-only via a registered privileged scheme. This keeps
// local comments offline + free, and — because the files are real on disk —
// reviewable by agents and humans alike.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { protocol, net } from 'electron';
import { LOCAL_ATTACHMENT_SCHEME, type ImageUploadInput } from '@shared/types.js';
import { getRepo } from './store.js';
import { validateImage } from './upload-broker.js';

const ATTACHMENTS_DIR = path.join('.super-review', 'attachments');

const EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp'
};

const CONTENT_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp'
};

// Absolute attachments dir for a repo, or null when the repo id is unknown.
function attachmentsDirFor(repoId: string): string | null {
	const repo = getRepo(repoId);
	if (!repo) return null;
	return path.join(repo.path, ATTACHMENTS_DIR);
}

export async function saveLocalAttachment(
	repoId: string,
	input: ImageUploadInput
): Promise<string> {
	validateImage(input);
	const dir = attachmentsDirFor(repoId);
	if (!dir) throw new Error('Unknown repository for attachment.');
	await fs.mkdir(dir, { recursive: true });
	const ext = EXTENSIONS[input.mimeType] ?? 'bin';
	const filename = `${randomUUID()}.${ext}`;
	await fs.writeFile(path.join(dir, filename), input.bytes);
	// host = repoId, path = /<filename>. encodeURIComponent the repo id so an id
	// with URL-special characters still parses.
	return `${LOCAL_ATTACHMENT_SCHEME}://${encodeURIComponent(repoId)}/${filename}`;
}

// Serve a stored attachment for an sr-asset:// request. The renderer only ever
// produces these URLs from saveLocalAttachment, but treat them as untrusted:
// resolve the file strictly inside the repo's attachments dir so a crafted
// `..`-laden URL can't escape it.
export function registerAttachmentProtocol(): void {
	protocol.handle(LOCAL_ATTACHMENT_SCHEME, async (request) => {
		const url = new URL(request.url);
		const repoId = decodeURIComponent(url.hostname);
		const dir = attachmentsDirFor(repoId);
		if (!dir) return new Response('Not found', { status: 404 });

		// Collapse to a bare filename so the request can't traverse out of `dir`.
		const filename = path.basename(decodeURIComponent(url.pathname));
		const full = path.join(dir, filename);
		const resolvedDir = path.resolve(dir);
		if (path.dirname(path.resolve(full)) !== resolvedDir) {
			return new Response('Forbidden', { status: 403 });
		}

		try {
			// net.fetch over a file:// URL streams the file and is the Electron-blessed
			// way to return local content from a protocol handler.
			const res = await net.fetch(`file://${full}`);
			if (!res.ok) return new Response('Not found', { status: 404 });
			const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
			const headers = new Headers();
			if (CONTENT_TYPES[ext]) headers.set('content-type', CONTENT_TYPES[ext]);
			headers.set('cache-control', 'no-cache');
			return new Response(res.body, { headers });
		} catch {
			return new Response('Not found', { status: 404 });
		}
	});
}
