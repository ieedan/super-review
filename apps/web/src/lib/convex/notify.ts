import { v } from 'convex/values';
import { internalAction, type ActionCtx } from './_generated/server';
import { internalMutation } from './utils';
import { internal } from './_generated/api';
import { env } from '../env.convex';
import type { Id } from './_generated/dataModel';
import {
	AUTO_ARCHIVE_MINUTES,
	MAX_ATTEMPTS,
	buildFeedbackEmbed,
	isRetryable,
	retryAfterSeconds,
	retryDelayMs,
	threadName
} from './notifyShared';

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
 * Neither call is fire and forget any more. Each outcome is written back to the
 * feedback row (`discordMessageId`, `discordThreadId`, `notifiedAt`,
 * `notifyError`), because "the report is in the database but there is no thread
 * in Discord" used to be indistinguishable from "it posted fine", and answering
 * which one it was meant reading Convex logs before they aged out. Transient
 * failures reschedule themselves; permanent ones (a bad token, a channel the
 * bot cannot see, a missing Create Public Threads permission) sit on the row
 * with their reason until the Discord side is fixed, and the hourly sweep then
 * delivers them.
 */

export const postFeedback = internalAction({
	args: { feedbackId: v.id('feedback'), attempt: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const attempt = args.attempt ?? 1;
		// Read the report back rather than carrying it through the scheduler:
		// a retry an hour later then needs nothing but the id, and cannot post a
		// stale copy of a row that has since been edited or deleted.
		const report = await ctx.runQuery(internal.feedback.loadForNotify, {
			feedbackId: args.feedbackId
		});
		if (!report) return; // deleted between scheduling and running
		if (report.notifiedAt) return; // a retry and the sweep raced; first one won

		const token = env.FEEDBACK_BOT_TOKEN;
		const channelId = env.FEEDBACK_CHANNEL_ID;
		if (!token || !channelId) {
			console.warn(
				`[notify] no FEEDBACK_BOT_TOKEN/FEEDBACK_CHANNEL_ID; feedback not posted:\n` +
					JSON.stringify(buildFeedbackEmbed(report), null, 2)
			);
			// Recorded rather than only logged: on a deployment that is supposed to
			// have a bot, an unset variable is the single most likely reason a
			// report never showed up, and this puts that on the row where it is
			// visible next to the report itself.
			await record(ctx, args.feedbackId, {
				error: 'FEEDBACK_BOT_TOKEN/FEEDBACK_CHANNEL_ID not set on this deployment'
			});
			return;
		}

		// Skipped when a previous attempt already posted: the message id on the
		// row is what stops a retry from double posting the report.
		let messageId = report.discordMessageId;
		if (!messageId) {
			const posted = await discord(token, `/channels/${channelId}/messages`, {
				embeds: [buildFeedbackEmbed(report)]
			});
			if (!posted.ok) {
				await fail(ctx, args.feedbackId, attempt, 'posting the report failed', posted);
				return;
			}
			messageId = (posted.body as { id?: string }).id;
			if (!messageId) {
				// Posted. There is just nothing to hang a thread from, and no amount
				// of retrying will produce an id Discord did not send.
				await record(ctx, args.feedbackId, {
					delivered: true,
					error: 'posted, but Discord returned no message id; no thread'
				});
				console.warn(`[notify] feedback ${args.feedbackId} posted without a message id; no thread`);
				return;
			}
			await record(ctx, args.feedbackId, { discordMessageId: messageId });
		}

		const thread = await discord(token, `/channels/${channelId}/messages/${messageId}/threads`, {
			name: threadName(report.category, report.title),
			auto_archive_duration: AUTO_ARCHIVE_MINUTES
		});
		if (!thread.ok) {
			await fail(ctx, args.feedbackId, attempt, 'opening its thread failed', thread);
			return;
		}

		await record(ctx, args.feedbackId, {
			// A thread started from a message carries the message's own id, so the
			// fallback is the right answer rather than a guess.
			discordThreadId: (thread.body as { id?: string }).id ?? messageId,
			delivered: true
		});
	}
});

/**
 * Hourly backstop for reports that never made it to Discord.
 *
 * The in-action retries only cover a transient failure over the following few
 * minutes. This covers the rest: a scheduled action that never ran, a bot token
 * that was wrong until someone fixed it, a permission that was missing until
 * someone granted it. Reports age out of the window rather than being retried
 * forever, and the batch is small because feedback volume is measured in
 * reports per day.
 */
const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 10;

export const sweepUndelivered = internalMutation({
	args: {},
	handler: async (ctx) => {
		// Nothing to re-deliver to. Without this a deployment with no bot (local
		// dev, which is a supported state) would re-log every report it has ever
		// stored, once an hour, for a week.
		if (!env.FEEDBACK_BOT_TOKEN || !env.FEEDBACK_CHANNEL_ID) return;

		const since = Date.now() - SWEEP_WINDOW_MS;
		const undelivered = await ctx.db
			.query('feedback')
			.withIndex('by_notifiedAt', (q) => q.eq('notifiedAt', undefined).gte('createdAt', since))
			.take(SWEEP_BATCH);

		for (const row of undelivered) {
			await ctx.scheduler.runAfter(0, internal.notify.postFeedback, { feedbackId: row._id });
		}
		if (undelivered.length > 0) {
			console.warn(`[notify] retrying ${undelivered.length} undelivered feedback report(s)`);
		}
	}
});

/** Writes an outcome back to the report. Never the reason a delivery fails. */
async function record(
	ctx: ActionCtx,
	feedbackId: Id<'feedback'>,
	outcome: {
		discordMessageId?: string;
		discordThreadId?: string;
		delivered?: boolean;
		error?: string;
	}
): Promise<void> {
	try {
		await ctx.runMutation(internal.feedback.recordDelivery, { feedbackId, ...outcome });
	} catch (err) {
		console.error(`[notify] could not record delivery state for ${feedbackId}`, err);
	}
}

/** Logs a failed step, records it on the row, and reschedules if it is worth it. */
async function fail(
	ctx: ActionCtx,
	feedbackId: Id<'feedback'>,
	attempt: number,
	what: string,
	res: DiscordResult
): Promise<void> {
	const reason = `${what}: ${res.status} ${res.detail}`.trim();
	const retrying = attempt < MAX_ATTEMPTS && isRetryable(res.status);
	console.error(
		`[notify] feedback ${feedbackId} attempt ${attempt}/${MAX_ATTEMPTS} ${reason}` +
			(retrying ? '; retrying' : '; giving up until the next sweep')
	);
	await record(ctx, feedbackId, { error: reason });
	if (!retrying) return;
	await ctx.scheduler.runAfter(
		retryDelayMs(attempt, retryAfterSeconds(res.body)),
		internal.notify.postFeedback,
		{ feedbackId, attempt: attempt + 1 }
	);
}

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
			// Read the body once, then reuse it: the text is what goes on the row,
			// and the JSON of the same text is where a 429 keeps its retry_after.
			const detail = await res.text().catch(() => '');
			return { ok: false, status: res.status, detail, body: parseJson(detail) };
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

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
