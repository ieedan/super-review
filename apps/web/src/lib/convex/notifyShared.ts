/**
 * The pure half of the feedback -> Discord notification: payload shaping and
 * retry policy, with no network and no Convex context.
 *
 * Split out of notify.ts so the parts that decide whether a report is
 * deliverable can be unit tested. Discord rejects a message outright when any
 * one of its limits is exceeded, and a rejected message means no thread and no
 * report, so the clipping below is the difference between a report arriving and
 * a report existing only as a database row.
 */

// Embed accent per category, so a bug report is recognizable in the channel
// before you have read a word of it.
export const CATEGORIES = {
	bug: { label: '🐛 Bug', color: 0xef4444 },
	idea: { label: '💡 Idea', color: 0xeab308 },
	other: { label: '💬 Feedback', color: 0x6366f1 }
} as const;

export type FeedbackCategory = keyof typeof CATEGORIES;

// Discord's own limits. Exceeding any of them rejects the entire message, so
// everything is clipped short of the real ceiling rather than at it.
export const MAX_THREAD_NAME = 100; // hard limit 100 (Discord channel/thread name)
export const MAX_TITLE = 200; // hard limit 256
export const MAX_DESCRIPTION = 3800; // hard limit 4096
export const MAX_FIELD_VALUE = 900; // hard limit 1024
export const MAX_AUTHOR_NAME = 250; // hard limit 256

// The limit that is easiest to miss: Discord also caps the *sum* of an embed's
// title, description, field names and values, footer and author at 6000
// characters. Each cap above is legal on its own, so a long report with a long
// context block can satisfy every individual limit and still be refused with a
// 400. The description absorbs the overflow because it is both the biggest
// contributor and the only field that reads fine truncated.
export const MAX_EMBED_TOTAL = 6000;

// Longest Discord allows (7 days), so a thread stays in the channel list for a
// working week before it archives.
export const AUTO_ARCHIVE_MINUTES = 10080;

/** Immediate retries before the hourly sweep takes over. */
export const MAX_ATTEMPTS = 5;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 15 * 60_000;

export function clip(text: string, max: number): string {
	if (max <= 0) return '';
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface FeedbackReport {
	feedbackId: string;
	category: FeedbackCategory;
	title: string;
	body: string;
	email?: string;
	context?: {
		action?: string;
		tab?: string;
		repo?: string;
		branch?: string;
		location?: string;
	};
	appVersion: string;
	platform: string;
	osRelease: string;
	arch?: string;
	electronVersion?: string;
	reporterName?: string;
	reporterEmail?: string;
	reporterImage?: string;
	plan?: string;
	status?: string;
}

export interface DiscordEmbed {
	author: { name: string; icon_url?: string };
	title: string;
	description: string;
	color: number;
	fields: { name: string; value: string; inline?: boolean }[];
	footer: { text: string };
}

/** What Discord counts against the 6000 character ceiling. */
export function embedLength(embed: DiscordEmbed): number {
	return (
		embed.author.name.length +
		embed.title.length +
		embed.description.length +
		embed.footer.text.length +
		embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0)
	);
}

export function buildFeedbackEmbed(report: FeedbackReport): DiscordEmbed {
	const { label, color } = CATEGORIES[report.category];

	const fields: DiscordEmbed['fields'] = [
		{ name: 'Category', value: label, inline: true },
		{
			name: 'Plan',
			// An anonymous report has no license to describe, and saying so is
			// more useful than an empty field.
			value: report.plan ? `${report.plan} (${report.status})` : 'not signed in',
			inline: true
		},
		{ name: 'App', value: clip(report.appVersion, MAX_FIELD_VALUE), inline: true },
		{
			name: 'System',
			value: clip(
				[
					report.arch ? `${report.platform}/${report.arch}` : report.platform,
					`OS ${report.osRelease}`,
					report.electronVersion ? `Electron ${report.electronVersion}` : null
				]
					.filter(Boolean)
					.join(' · '),
				MAX_FIELD_VALUE
			),
			inline: false
		}
	];

	// What the user was doing, when the report came from an error toast. This
	// is the part that turns "it broke" into something reproducible.
	const ctx = report.context;
	if (ctx) {
		const lines = [
			ctx.action ? `Action:   ${ctx.action}` : null,
			ctx.tab ? `Tab:      ${ctx.tab}` : null,
			ctx.repo ? `Repo:     ${ctx.repo}` : null,
			ctx.branch ? `Branch:   ${ctx.branch}` : null,
			ctx.location ? `Location: ${ctx.location}` : null
		].filter(Boolean);
		if (lines.length > 0) {
			fields.push({
				name: 'Context',
				value: clip(`\`\`\`\n${lines.join('\n')}\n\`\`\``, MAX_FIELD_VALUE),
				inline: false
			});
		}
	}

	// The reply-to the reporter typed, which may differ from their account
	// email, so both can be worth having.
	if (report.email && report.email !== report.reporterEmail) {
		fields.push({
			name: 'Reply to',
			value: clip(report.email, MAX_FIELD_VALUE),
			inline: false
		});
	}

	const embed: DiscordEmbed = {
		author: {
			name: clip(report.reporterName ?? report.reporterEmail ?? 'Anonymous', MAX_AUTHOR_NAME),
			...(report.reporterImage ? { icon_url: report.reporterImage } : {})
		},
		title: clip(report.title, MAX_TITLE),
		description: clip(report.body, MAX_DESCRIPTION),
		color,
		fields,
		// The row id is what you search Convex by when you need the untruncated
		// body or the reporter's license.
		footer: { text: report.feedbackId }
	};

	const over = embedLength(embed) - MAX_EMBED_TOTAL;
	if (over > 0) {
		// Never below zero: the fields alone cannot reach 6000, so there is always
		// room left for at least part of the body.
		embed.description = clip(embed.description, Math.max(embed.description.length - over, 0));
	}
	return embed;
}

export function threadName(category: FeedbackCategory, title: string): string {
	return clip(`${CATEGORIES[category].label} ${title}`, MAX_THREAD_NAME);
}

/**
 * Whether a failed Discord call is worth trying again.
 *
 * Rate limits and Discord's own 5xx are transient. A 401/403/400 is not: a bad
 * token, a channel the bot cannot see, a missing Create Public Threads
 * permission or a rejected payload all stay broken until someone changes
 * something, so retrying only burns requests. The hourly sweep is what picks
 * those up once the Discord side is fixed.
 */
export function isRetryable(status: number | string): boolean {
	if (status === 'threw') return true; // network blip reaching Discord at all
	if (typeof status !== 'number') return false;
	return status === 429 || (status >= 500 && status < 600);
}

/**
 * How long to wait before the next attempt: exponential backoff, but never
 * sooner than the `retry_after` Discord asked for on a 429.
 */
export function retryDelayMs(attempt: number, retryAfterSeconds?: number): number {
	const backoff = BASE_RETRY_MS * 2 ** Math.max(attempt - 1, 0);
	const requested = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0;
	return Math.min(Math.max(backoff, requested), MAX_RETRY_MS);
}

/** Discord reports rate limits as `retry_after` seconds in the error body. */
export function retryAfterSeconds(body: unknown): number | undefined {
	const value = (body as { retry_after?: unknown } | null)?.retry_after;
	return typeof value === 'number' ? value : undefined;
}
