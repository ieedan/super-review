/**
 * Splitting a half-written commit message for display.
 *
 * The agent answers with the message itself: subject on the first line, blank
 * line, then the body. Mid-stream that means everything up to the first newline
 * is the subject (still growing), and everything after the blank line is the
 * body. The main process runs the strict parser on the finished text — this one
 * only has to be right enough to render, and never throw away characters.
 */
export interface StreamingMessage {
	subject: string;
	body: string;
}

export function splitStreamingMessage(answer: string): StreamingMessage {
	const text = answer.replace(/\r\n/g, '\n');
	if (!text.trim()) return { subject: '', body: '' };

	const lines = text.split('\n');
	let i = 0;
	while (i < lines.length && !lines[i]!.trim()) i++;

	// Drop a label a model sometimes leads with, the same way the final parse does.
	const subject = (lines[i] ?? '').replace(
		/^\s*(?:subject|title|commit(?:\s+message)?)\s*:\s*/i,
		''
	);
	const body = lines
		.slice(i + 1)
		.join('\n')
		.replace(/^\s*(?:body|description)\s*:\s*/i, '')
		.trim();

	return { subject: subject.trim(), body };
}
