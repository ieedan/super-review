import { cronJobs } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './utils';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const IP_SPRAY_THRESHOLD = 20;
const EVENT_RETENTION_MS = 14 * DAY_MS;

const crons = cronJobs();

// Hourly: flag IP spray across recently-active licenses.
crons.interval('abuse ip sweep', { hours: 1 }, internal.crons.ipSpraySweep, {});
// Daily: prune old validation events.
crons.interval('prune validation events', { hours: 24 }, internal.crons.pruneValidationEvents, {});
// Hourly: re-deliver feedback that never reached Discord. Lives in notify.ts
// next to the delivery it retries.
crons.interval('retry undelivered feedback', { hours: 1 }, internal.notify.sweepUndelivered, {});

export default crons;

export const ipSpraySweep = internalMutation({
	args: {},
	handler: async (ctx) => {
		const since = Date.now() - DAY_MS;
		// Sweep licenses that saw validation activity in the last day.
		const recentEvents = await ctx.db
			.query('validationEvents')
			.filter((q) => q.gte(q.field('at'), since))
			.collect();

		const byLicense = new Map<string, Set<string>>();
		for (const ev of recentEvents) {
			if (!ev.ipHash) continue;
			const key = ev.licenseId as unknown as string;
			const set = byLicense.get(key) ?? new Set<string>();
			set.add(ev.ipHash);
			byLicense.set(key, set);
		}

		for (const [licenseId, ips] of byLicense) {
			if (ips.size < IP_SPRAY_THRESHOLD) continue;
			const id = licenseId as unknown as Parameters<typeof ctx.db.get>[0];
			const open = await ctx.db
				.query('abuseFlags')
				.withIndex('by_licenseId', (q) => q.eq('licenseId', id as never))
				.filter((q) => q.eq(q.field('resolvedAt'), undefined))
				.collect();
			if (open.some((f) => f.kind === 'ip_spray')) continue;
			await ctx.db.insert('abuseFlags', {
				licenseId: id as never,
				kind: 'ip_spray',
				details: `${ips.size} distinct IPs in 24h`,
				action: 'none',
				createdAt: Date.now()
			});
		}
	}
});

export const pruneValidationEvents = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx) => {
		const cutoff = Date.now() - EVENT_RETENTION_MS;
		const stale = await ctx.db
			.query('validationEvents')
			.filter((q) => q.lt(q.field('at'), cutoff))
			.take(500);
		for (const ev of stale) {
			await ctx.db.delete(ev._id);
		}
	}
});
