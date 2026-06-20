import { app as electronApp } from 'electron';
import {
	FEEDBACK_IMAGE_TYPES,
	FEEDBACK_MAX_FILES,
	FEEDBACK_MAX_IMAGE_BYTES,
	FEEDBACK_MAX_TOTAL_BYTES,
	FEEDBACK_MAX_VIDEO_BYTES,
	FEEDBACK_REPO,
	FEEDBACK_VIDEO_TYPES,
	type FeedbackAttachmentInput,
	type FeedbackConfig,
	type FeedbackKind,
	type FeedbackSubmission,
	type FeedbackSubmissionResult
} from '@shared/types.js';
import { createFeedbackIssue, getActiveAccountToken } from './github-service.js';

// URL of the R2-backed upload broker (a Cloudflare Worker — see
// infra/feedback-uploader). When unset, the dialog still files text-only issues
// but image/video attachments are disabled. A trailing slash is tolerated.
const UPLOAD_URL = process.env.SUPER_REVIEW_FEEDBACK_UPLOAD_URL?.replace(/\/+$/, '');

// Lets a fork/self-host redirect feedback to its own repo without a rebuild,
// e.g. SUPER_REVIEW_FEEDBACK_REPO="acme/super-review".
function feedbackRepo(): { owner: string; repo: string } {
	const override = process.env.SUPER_REVIEW_FEEDBACK_REPO;
	if (override) {
		const [owner, repo] = override.split('/');
		if (owner && repo) return { owner, repo };
	}
	return { owner: FEEDBACK_REPO.owner, repo: FEEDBACK_REPO.repo };
}

const IMAGE_TYPES = new Set<string>(FEEDBACK_IMAGE_TYPES);
const VIDEO_TYPES = new Set<string>(FEEDBACK_VIDEO_TYPES);

function isImage(mimeType: string): boolean {
	return IMAGE_TYPES.has(mimeType);
}
function isVideo(mimeType: string): boolean {
	return VIDEO_TYPES.has(mimeType);
}

export function getFeedbackConfig(): FeedbackConfig {
	return {
		uploadConfigured: !!UPLOAD_URL,
		signedIn: !!getActiveAccountToken(),
		maxImageBytes: FEEDBACK_MAX_IMAGE_BYTES,
		maxVideoBytes: FEEDBACK_MAX_VIDEO_BYTES,
		maxFiles: FEEDBACK_MAX_FILES,
		maxTotalBytes: FEEDBACK_MAX_TOTAL_BYTES,
		imageTypes: [...FEEDBACK_IMAGE_TYPES],
		videoTypes: [...FEEDBACK_VIDEO_TYPES]
	};
}

// Map a feedback kind to the GitHub labels we file it under. Every feedback issue
// carries the `feedback` label so the triage workflow can select it; the second
// label is the kind in GitHub's conventional vocabulary so the workflow (and
// humans) can route it.
function labelsFor(kind: FeedbackKind): string[] {
	const kindLabel = kind === 'feature' ? 'enhancement' : kind === 'bug' ? 'bug' : 'question';
	return ['feedback', kindLabel];
}

// Reject anything we won't store: an unknown type, an oversized file, too many
// files, or too large a combined payload. Mirrored by the broker so a hand-rolled
// IPC call can't bypass these.
function validateAttachments(attachments: FeedbackAttachmentInput[]): void {
	if (attachments.length > FEEDBACK_MAX_FILES) {
		throw new Error(`Too many attachments — at most ${FEEDBACK_MAX_FILES} are allowed.`);
	}
	let total = 0;
	for (const att of attachments) {
		const size = att.bytes.byteLength;
		total += size;
		if (isImage(att.mimeType)) {
			if (size > FEEDBACK_MAX_IMAGE_BYTES) {
				throw new Error(
					`"${att.name}" is too large (${formatBytes(size)}). Images must be ${formatBytes(
						FEEDBACK_MAX_IMAGE_BYTES
					)} or smaller.`
				);
			}
		} else if (isVideo(att.mimeType)) {
			if (size > FEEDBACK_MAX_VIDEO_BYTES) {
				throw new Error(
					`"${att.name}" is too large (${formatBytes(size)}). Videos must be ${formatBytes(
						FEEDBACK_MAX_VIDEO_BYTES
					)} or smaller.`
				);
			}
		} else {
			throw new Error(`"${att.name}" is not a supported image or video type (${att.mimeType}).`);
		}
	}
	if (total > FEEDBACK_MAX_TOTAL_BYTES) {
		throw new Error(
			`Attachments total ${formatBytes(total)}, over the ${formatBytes(
				FEEDBACK_MAX_TOTAL_BYTES
			)} limit.`
		);
	}
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadedMedia {
	name: string;
	mimeType: string;
	url: string;
}

// Push one attachment to the broker, which validates the bearer token (the user's
// GitHub token) before storing the bytes in R2 and returning a public URL.
async function uploadAttachment(
	att: FeedbackAttachmentInput,
	token: string
): Promise<UploadedMedia> {
	if (!UPLOAD_URL) throw new Error('Attachment uploads are not configured.');
	// Copy into a fresh ArrayBuffer so a SharedArrayBuffer-backed view (or a
	// partial view over a larger buffer) is sent as exactly these bytes.
	const body = att.bytes.slice().buffer;
	const res = await fetch(`${UPLOAD_URL}/upload`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': att.mimeType,
			'X-Filename': encodeURIComponent(att.name)
		},
		body
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(
			`Upload failed for "${att.name}" (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`
		);
	}
	const data = (await res.json()) as { url?: string };
	if (!data.url) throw new Error(`Upload of "${att.name}" returned no URL.`);
	return { name: att.name, mimeType: att.mimeType, url: data.url };
}

// Render uploaded media as a markdown "Attachments" section: images inline,
// videos as a <video> tag (GitHub renders it) with a plain-link fallback.
function renderAttachments(media: UploadedMedia[]): string {
	if (media.length === 0) return '';
	const parts = media.map((m) => {
		if (isVideo(m.mimeType)) {
			return `**${m.name}**\n\n<video src="${m.url}" controls></video>\n\n[Open video](${m.url})`;
		}
		return `![${m.name}](${m.url})`;
	});
	return `\n\n### Attachments\n\n${parts.join('\n\n')}`;
}

function renderDiagnostics(diagnostics: string | undefined): string {
	const env = `super-review ${electronApp.getVersion()} · ${process.platform} · electron ${process.versions.electron}`;
	const inner = diagnostics ? `${diagnostics}\n\n${env}` : env;
	return `\n\n<details>\n<summary>Diagnostics</summary>\n\n\`\`\`\n${inner}\n\`\`\`\n\n</details>`;
}

const TITLE_PREFIX: Record<FeedbackKind, string> = {
	bug: '[Bug] ',
	feature: '[Feature] ',
	other: '[Feedback] '
};

export async function submitFeedback(input: FeedbackSubmission): Promise<FeedbackSubmissionResult> {
	const title = input.title.trim();
	if (!title) throw new Error('Please add a short title.');

	const token = getActiveAccountToken();
	if (!token) throw new Error('Sign in to GitHub before sending feedback.');

	validateAttachments(input.attachments);

	// Upload sequentially so a failure stops early with a clear message rather
	// than racing several large uploads.
	const media: UploadedMedia[] = [];
	for (const att of input.attachments) {
		media.push(await uploadAttachment(att, token));
	}

	const body =
		`${input.body.trim() || '_No description provided._'}` +
		renderAttachments(media) +
		renderDiagnostics(input.diagnostics);

	const { owner, repo } = feedbackRepo();
	return createFeedbackIssue({
		owner,
		repo,
		title: `${TITLE_PREFIX[input.kind]}${title}`,
		body,
		labels: labelsFor(input.kind)
	});
}
