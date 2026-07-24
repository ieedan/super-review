import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { env } from '../env.convex';

/**
 * Outbound notifications to Discord.
 *
 * Same contract as the Loops emails in email.ts: these run as scheduled actions
 * after the database write has committed, so a failure is logged and swallowed
 * rather than thrown. The feedback row is already durable; the webhook is only
 * how it reaches you promptly. With no bot configured the whole payload is
 * logged to the Convex console instead, so local dev needs no Discord setup at
 * all.
 *
 * Threading: each report gets its own thread hanging off its message, so the
 * discussion of one report stays attached to it. That takes two calls, both on
 * the main REST API and both authenticated with a bot token: post the message,
 * then open a thread on the message just posted.
 *
 * This used to post through an incoming webhook, but a webhook credential only
 * authenticates /webhooks endpoints and so cannot open a thread. Once a bot is
 * needed for the thread anyway, having it post the message too means one
 * credential instead of two, and no second thing to keep alive.
 *
 * The thread is best effort: if it fails, the report is already in the channel
 * and already in the database, so a missing thread is a cosmetic loss.
 */

// Embed accent per category, so a bug report is recognizable in the channel
// before you have read a word of it.
const CATEGORIES = {
	bug: { label: '🐛 Bug', color: 0xef4444 },
	idea: { label: '💡 Idea', color: 0xeab308 },
	other: { label: '💬 Feedback', color: 0x6366f1 }
} as const;

// Discord's own limits. Exceeding any of them rejects the entire message, so
// everything is clipped short of the real ceiling rather than at it.
const MAX_THREAD_NAME = 100; // hard limit 100 (Discord channel/thread name)
const MAX_TITLE = 200; // hard limit 256
const MAX_DESCRIPTION = 3800; // hard limit 4096
const MAX_FIELD_VALUE = 900; // hard limit 1024

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const contextValidator = v.object({
	action: v.optional(v.string()),
	tab: v.optional(v.string()),
	repo: v.optional(v.string()),
	branch: v.optional(v.string()),
	location: v.optional(v.string())
});

export const postFeedback = internalAction({
	args: {
		feedbackId: v.id('feedback'),
		category: v.union(v.literal('bug'), v.literal('idea'), v.literal('other')),
		title: v.string(),
		body: v.string(),
		email: v.optional(v.string()),
		context: v.optional(contextValidator),
		appVersion: v.string(),
		platform: v.string(),
		osRelease: v.string(),
		arch: v.optional(v.string()),
		electronVersion: v.optional(v.string()),
		reporterName: v.optional(v.string()),
		reporterEmail: v.optional(v.string()),
		reporterImage: v.optional(v.string()),
		plan: v.optional(v.string()),
		status: v.optional(v.string())
	},
	handler: async (_ctx, args) => {
		const { label, color } = CATEGORIES[args.category];

		const fields: { name: string; value: string; inline?: boolean }[] = [
			{ name: 'Category', value: label, inline: true },
			{
				name: 'Plan',
				// An anonymous report has no license to describe, and saying so is
				// more useful than an empty field.
				value: args.plan ? `${args.plan} (${args.status})` : 'not signed in',
				inline: true
			},
			{ name: 'App', value: clip(args.appVersion, MAX_FIELD_VALUE), inline: true },
			{
				name: 'System',
				value: clip(
					[
						args.arch ? `${args.platform}/${args.arch}` : args.platform,
						`OS ${args.osRelease}`,
						args.electronVersion ? `Electron ${args.electronVersion}` : null
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
		const ctx = args.context;
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
		if (args.email && args.email !== args.reporterEmail) {
			fields.push({ name: 'Reply to', value: clip(args.email, MAX_FIELD_VALUE), inline: false });
		}

		const embed = {
			author: {
				name: clip(args.reporterName ?? args.reporterEmail ?? 'Anonymous', 250),
				...(args.reporterImage ? { icon_url: args.reporterImage } : {})
			},
			title: clip(args.title, MAX_TITLE),
			description: clip(args.body, MAX_DESCRIPTION),
			color,
			fields,
			// The row id is what you search Convex by when you need the untruncated
			// body or the reporter's license.
			footer: { text: args.feedbackId }
		};

		const token = env.FEEDBACK_BOT_TOKEN;
		const channelId = env.FEEDBACK_CHANNEL_ID;
		if (!token || !channelId) {
			console.warn(
				`[notify] no FEEDBACK_BOT_TOKEN/FEEDBACK_CHANNEL_ID; feedback not posted:\n` +
					JSON.stringify(embed, null, 2)
			);
			return;
		}

		const message = await discord(token, `/channels/${channelId}/messages`, { embeds: [embed] });
		if (!message.ok) {
			console.error(
				`[notify] feedback ${args.feedbackId} NOT delivered: ${message.status} ${message.detail}`
			);
			return;
		}

		const messageId = (message.body as { id?: string }).id;
		if (!messageId) {
			// Posted. There is just nothing to hang a thread from.
			console.warn(`[notify] feedback ${args.feedbackId} posted, but had no message id; no thread`);
			return;
		}

		const thread = await discord(token, `/channels/${channelId}/messages/${messageId}/threads`, {
			name: clip(`${label} ${args.title}`, MAX_THREAD_NAME),
			// 10080 minutes = 7 days, the longest Discord allows, so a thread stays
			// in the channel list for a working week before it archives.
			auto_archive_duration: 10080
		});
		if (!thread.ok) {
			console.error(
				`[notify] feedback ${args.feedbackId} posted, but opening its thread failed: ` +
					`${thread.status} ${thread.detail}`
			);
		}
	}
});

interface DiscordResult {
	ok: boolean;
	status: number | string;
	detail: string;
	body: unknown;
}

/** One authenticated POST to the Discord REST API. Never throws. */
async function discord(token: string, path: string, payload: unknown): Promise<DiscordResult> {
	try {
		const res = await fetch(`https://discord.com/api/v10${path}`, {
			method: 'POST',
			headers: {
				authorization: `Bot ${token}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			return {
				ok: false,
				status: res.status,
				detail: await res.text().catch(() => ''),
				body: null
			};
		}
		return { ok: true, status: res.status, detail: '', body: await res.json().catch(() => ({})) };
	} catch (err) {
		return {
			ok: false,
			status: 'threw',
			detail: err instanceof Error ? err.message : String(err),
			body: null
		};
	}
}
