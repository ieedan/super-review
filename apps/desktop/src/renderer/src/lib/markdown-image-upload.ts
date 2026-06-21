// Paste/drop image upload for the markdown composers. Attaches to a <textarea>
// (Carta's inner one or a plain shadcn Textarea) and, when an image is pasted or
// dropped, inserts a `![uploading…]()` placeholder at the caret, uploads, then
// swaps in `![name](url)`. Remote targets push to the R2 broker (GitHub-bound
// text); local targets save to disk and get an sr-asset:// URL (local-only
// comments). The composer owns the bound value, so we read/write it through
// callbacks rather than touching the textarea's value directly.

// Where a composer's images go. `local` keeps them on disk for local-only
// review comments; `remote` uploads to the broker for GitHub-bound markdown.
export type ImageUploadTarget = { mode: 'remote' } | { mode: 'local'; repoId: string };

export interface AttachImageUploadOptions {
	target: ImageUploadTarget;
	getValue: () => string;
	setValue: (next: string) => void;
	// Surface an upload failure (e.g. too large, signed out). Optional.
	onError?: (message: string) => void;
}

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function imageFilesFrom(list: DataTransferItemList | FileList | null | undefined): File[] {
	if (!list) return [];
	const files: File[] = [];
	for (const entry of Array.from(list as ArrayLike<DataTransferItem | File>)) {
		const file = 'getAsFile' in entry ? entry.getAsFile() : entry;
		if (file && ALLOWED.has(file.type)) files.push(file);
	}
	return files;
}

// Whether a drag carries an image, checked via item `type` only — during
// `dragover` the payload isn't readable yet (getAsFile() returns null), so we
// can't materialize Files; we just need to know whether to accept the drop.
function dragHasImage(items: DataTransferItemList | undefined): boolean {
	if (!items) return false;
	for (const item of Array.from(items)) {
		if (item.kind === 'file' && ALLOWED.has(item.type)) return true;
	}
	return false;
}

async function uploadOne(file: File, target: ImageUploadTarget): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const name = file.name || `image.${file.type.split('/')[1] ?? 'png'}`;
	const input = { name, mimeType: file.type, bytes };
	return target.mode === 'local'
		? window.api.attachments.saveLocal(target.repoId, input)
		: window.api.uploads.uploadImage(input);
}

// Replace the first occurrence of `token` in the current value with `replacement`
// (read live, since the user may have kept typing during the upload).
function replaceToken(opts: AttachImageUploadOptions, token: string, replacement: string): void {
	const current = opts.getValue();
	if (!current.includes(token)) return;
	opts.setValue(current.replace(token, replacement));
}

async function handleFile(
	file: File,
	textarea: HTMLTextAreaElement,
	opts: AttachImageUploadOptions
): Promise<void> {
	const name = file.name || 'image';
	// A unique token so concurrent uploads don't clobber each other's placeholders.
	const token = `![Uploading ${name}… ${crypto.randomUUID().slice(0, 8)}]()`;

	// Insert the placeholder at the caret (or replacing the selection).
	const value = opts.getValue();
	const start = textarea.selectionStart ?? value.length;
	const end = textarea.selectionEnd ?? value.length;
	opts.setValue(value.slice(0, start) + token + value.slice(end));

	try {
		const url = await uploadOne(file, opts.target);
		replaceToken(opts, token, `![${name}](${url})`);
	} catch (err) {
		replaceToken(opts, token, '');
		opts.onError?.(err instanceof Error ? err.message : String(err));
	}
}

// Wire paste + drop handlers onto `textarea`. Returns a cleanup function.
export function attachImageUpload(
	textarea: HTMLTextAreaElement,
	opts: AttachImageUploadOptions
): () => void {
	const onPaste = (e: ClipboardEvent): void => {
		const files = imageFilesFrom(e.clipboardData?.items);
		if (files.length === 0) return; // let normal text paste through
		e.preventDefault();
		for (const file of files) void handleFile(file, textarea, opts);
	};

	const onDrop = (e: DragEvent): void => {
		const files = imageFilesFrom(e.dataTransfer?.files);
		if (files.length === 0) return;
		e.preventDefault();
		for (const file of files) void handleFile(file, textarea, opts);
	};

	// Needed so the textarea is a valid drop target (default dragover cancels it).
	const onDragOver = (e: DragEvent): void => {
		if (dragHasImage(e.dataTransfer?.items)) e.preventDefault();
	};

	textarea.addEventListener('paste', onPaste);
	textarea.addEventListener('drop', onDrop);
	textarea.addEventListener('dragover', onDragOver);
	return () => {
		textarea.removeEventListener('paste', onPaste);
		textarea.removeEventListener('drop', onDrop);
		textarea.removeEventListener('dragover', onDragOver);
	};
}
