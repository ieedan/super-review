/**
 * One-shot migration of the pre-Convex waitlist.
 *
 * The old marketing site stored signups in an Upstash Redis sorted set (key
 * `waitlist`, member = normalized email, score = signup time in ms). This module
 * carries those addresses into `waitlistSignups` and sends each of them the
 * "you're on the list" confirmation they never got.
 *
 * Deliberately two phases, run as two separate commands:
 *
 *   1. `importFromUpstash` - reads Redis, inserts rows. Sends nothing.
 *   2. `sendImportedConfirmations` - mails the imported rows, paced, resumable.
 *
 * Splitting them is the whole point. Phase 1 is idempotent and reversible in
 * practice (you can look at what landed before anything leaves the building);
 * phase 2 is a mail-out to real people, which is not. Being able to run the
 * import, read `importStatus`, and only then send is worth the extra command.
 *
 * Both phases are safe to re-run: phase 1 skips addresses already on the list,
 * phase 2 skips rows that already have `confirmationSentAt`.
 *
 * Everything here is internal (Convex dashboard or `convex run`), and the whole
 * module can be deleted once the migration has been done.
 */
import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internalMutation } from './utils';
import { internal } from './_generated/api';
import { env } from '../env.convex';
import { isValidEmail, normalizeEmail } from './waitlist';

/** The sorted set the old site wrote to. */
const DEFAULT_KEY = 'waitlist';

/**
 * Rows per insert transaction. Each row costs one index read and at most one
 * insert, so this stays far inside Convex's per-mutation limits while keeping
 * the number of round trips small.
 */
const INSERT_BATCH = 200;

/**
 * Rows one mailing pass takes on, and how far apart the sends are spaced.
 *
 * Loops allows 10 requests a second; 250ms puts us at 4, which leaves room for
 * ordinary traffic (a signup, an invite) to go out alongside the backfill
 * instead of queueing behind it. A pass therefore covers roughly 50 seconds of
 * scheduled sends before handing over to the next one.
 */
const EMAIL_BATCH = 200;
const EMAIL_SPACING_MS = 250;

type ImportRow = { email: string; createdAt: number };

// These handlers call back into `internal.waitlistImport.*`, which makes their
// return types self-referential through the generated api. TypeScript can't
// infer through that cycle, so the two phases spell their results out.
type ImportStatus = {
	signups: number;
	imported: number;
	confirmationSent: number;
	confirmationPending: number;
};

type ImportResult =
	| {
			dryRun: true;
			inRedis: number;
			importable: number;
			invalid: string[];
			sample: string[];
			alreadyOnList: ImportStatus;
	  }
	| { inRedis: number; created: number; existing: number; invalid: string[] };

type SendResult =
	| { dryRun: true; wouldSend: number; thisBatch: number; sample: string[] }
	| { scheduled: number; continuing: boolean };

/**
 * Reads the whole sorted set over Upstash's REST API.
 *
 * `ZRANGE ... WITHSCORES` comes back as a flat [member, score, member, score]
 * array with the scores as strings. Read in one shot rather than paged: this is
 * a few thousand addresses at most, and a partial read would be worse than no
 * read (phase 2 mails whatever landed).
 */
async function readUpstashWaitlist(key: string): Promise<ImportRow[]> {
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;
	if (!url || !token) {
		throw new Error(
			'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set on this deployment. ' +
				'Set them with `npx convex env set`, or pass the addresses to waitlistImport:importRows instead.'
		);
	}

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify(['ZRANGE', key, '0', '-1', 'WITHSCORES'])
	});
	if (!res.ok) {
		throw new Error(`Upstash ZRANGE failed: ${res.status} ${await res.text()}`);
	}

	const body = (await res.json()) as { result?: unknown; error?: string };
	if (body.error) throw new Error(`Upstash ZRANGE error: ${body.error}`);
	const flat = body.result;
	if (!Array.isArray(flat)) {
		throw new Error(`Upstash ZRANGE returned ${typeof flat}, expected an array`);
	}

	const rows: ImportRow[] = [];
	for (let i = 0; i < flat.length; i += 2) {
		const email = String(flat[i]);
		const score = Number(flat[i + 1]);
		rows.push({ email, createdAt: Number.isFinite(score) ? score : Date.now() });
	}
	return rows;
}

/**
 * Normalizes, drops junk, and collapses duplicates keeping the earliest signup
 * time. The old set was keyed on an already-normalized address, but it was
 * written by a different validator, so nothing is assumed about what is in it.
 */
function prepare(rows: ImportRow[]): { valid: ImportRow[]; invalid: string[] } {
	const byEmail = new Map<string, number>();
	const invalid: string[] = [];

	for (const row of rows) {
		const email = normalizeEmail(row.email);
		if (!isValidEmail(email)) {
			invalid.push(row.email);
			continue;
		}
		const seen = byEmail.get(email);
		byEmail.set(email, seen === undefined ? row.createdAt : Math.min(seen, row.createdAt));
	}

	return {
		valid: [...byEmail].map(([email, createdAt]) => ({ email, createdAt })),
		invalid
	};
}

/**
 * Phase 1. Pulls the old list across.
 *
 * Sends nothing, on purpose - see the module comment. Run with
 * `{"dryRun": true}` first to see what would land.
 *
 *   convex run waitlistImport:importFromUpstash '{"dryRun":true}'
 *   convex run waitlistImport:importFromUpstash '{}'
 */
export const importFromUpstash = internalAction({
	args: { dryRun: v.optional(v.boolean()), key: v.optional(v.string()) },
	handler: async (ctx, args): Promise<ImportResult> => {
		const raw = await readUpstashWaitlist(args.key ?? DEFAULT_KEY);
		const { valid, invalid } = prepare(raw);

		if (args.dryRun) {
			// Read-only, so it can report what is already here without writing.
			const status: ImportStatus = await ctx.runQuery(internal.waitlistImport.importStatus, {});
			return {
				dryRun: true as const,
				inRedis: raw.length,
				importable: valid.length,
				invalid,
				sample: valid.slice(0, 10).map((r) => r.email),
				alreadyOnList: status
			};
		}

		let created = 0;
		let existing = 0;
		for (let i = 0; i < valid.length; i += INSERT_BATCH) {
			const res = await ctx.runMutation(internal.waitlistImport.importRows, {
				rows: valid.slice(i, i + INSERT_BATCH)
			});
			created += res.created;
			existing += res.existing;
		}

		console.log(
			`[waitlist-import] ${raw.length} in Redis, ${created} imported, ${existing} already on the list, ${invalid.length} invalid`
		);
		return { inRedis: raw.length, created, existing, invalid };
	}
});

/**
 * Inserts a batch of addresses, skipping any already on the list.
 *
 * Split out from the action so the insert is transactional, and exposed
 * separately so the migration still works if the Upstash database is gone: dump
 * the sorted set by hand and pass the rows in directly.
 *
 *   convex run waitlistImport:importRows '{"rows":[{"email":"a@b.com","createdAt":1730000000000}]}'
 */
export const importRows = internalMutation({
	args: {
		rows: v.array(v.object({ email: v.string(), createdAt: v.number() }))
	},
	handler: async (ctx, args) => {
		let created = 0;
		let existing = 0;

		for (const row of args.rows) {
			const email = normalizeEmail(row.email);
			if (!isValidEmail(email)) continue;

			const already = await ctx.db
				.query('waitlistSignups')
				.withIndex('by_email', (q) => q.eq('email', email))
				.unique();
			if (already) {
				existing++;
				continue;
			}

			await ctx.db.insert('waitlistSignups', {
				email,
				// Their original signup time, not now, so `invites:inviteNext` still
				// goes out in the order people actually joined. The whole point of
				// carrying the list across is that these people were there first.
				createdAt: row.createdAt,
				importedFrom: 'upstash'
			});
			created++;
		}

		return { created, existing };
	}
});

/**
 * Phase 2. Mails the imported addresses their confirmation, paced and
 * resumable.
 *
 * One pass takes `batchSize` rows, schedules a send for each spaced
 * `EMAIL_SPACING_MS` apart, marks them, and - if the batch came back full -
 * schedules itself to pick up where it left off once those sends have gone out.
 * So a single command drains the list at a fixed rate, and an interrupted run is
 * restarted by running it again.
 *
 * Scheduling and marking happen in the same transaction, which is why this is a
 * mutation rather than an action: a row can't end up marked-but-unsent or
 * sent-but-unmarked, and re-running can't double-mail anyone.
 *
 *   convex run waitlistImport:sendImportedConfirmations '{"dryRun":true}'
 *   convex run waitlistImport:sendImportedConfirmations '{}'
 */
export const sendImportedConfirmations = internalMutation({
	args: {
		dryRun: v.optional(v.boolean()),
		batchSize: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<SendResult> => {
		const batchSize = Math.max(1, Math.min(args.batchSize ?? EMAIL_BATCH, EMAIL_BATCH));

		const pending = await ctx.db
			.query('waitlistSignups')
			.withIndex('by_importedFrom_confirmationSentAt', (q) =>
				q.eq('importedFrom', 'upstash').eq('confirmationSentAt', undefined)
			)
			.take(batchSize);

		if (args.dryRun) {
			const remaining = await ctx.db
				.query('waitlistSignups')
				.withIndex('by_importedFrom_confirmationSentAt', (q) =>
					q.eq('importedFrom', 'upstash').eq('confirmationSentAt', undefined)
				)
				.collect();
			return {
				dryRun: true as const,
				wouldSend: remaining.length,
				thisBatch: pending.length,
				sample: pending.slice(0, 10).map((r) => r.email)
			};
		}

		const now = Date.now();
		for (const [i, row] of pending.entries()) {
			await ctx.scheduler.runAfter(i * EMAIL_SPACING_MS, internal.email.sendWaitlistConfirmation, {
				email: row.email
			});
			// Marked at scheduling time rather than on delivery: the send itself is
			// best effort (see convex/email.ts), and a failed send is recoverable from
			// the logs, whereas an unmarked row would be re-mailed by the next pass.
			await ctx.db.patch(row._id, { confirmationSentAt: now });
		}

		// A full batch means there is probably more. Hand over only after this
		// batch's sends have cleared, so the pacing holds across passes too.
		const more = pending.length === batchSize;
		if (more) {
			await ctx.scheduler.runAfter(
				batchSize * EMAIL_SPACING_MS + 1000,
				internal.waitlistImport.sendImportedConfirmations,
				{ batchSize }
			);
		}

		console.log(`[waitlist-import] scheduled ${pending.length} confirmations, continuing: ${more}`);
		return { scheduled: pending.length, continuing: more };
	}
});

/** Where the migration stands: how many came across, and who is still owed mail. */
export const importStatus = internalQuery({
	args: {},
	handler: async (ctx): Promise<ImportStatus> => {
		const all = await ctx.db.query('waitlistSignups').collect();
		const imported = all.filter((r) => r.importedFrom === 'upstash');
		return {
			signups: all.length,
			imported: imported.length,
			confirmationSent: imported.filter((r) => r.confirmationSentAt !== undefined).length,
			confirmationPending: imported.filter((r) => r.confirmationSentAt === undefined).length
		};
	}
});
