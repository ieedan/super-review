import { describe, it, expect } from 'vitest';
import {
	MAX_EMBED_TOTAL,
	MAX_THREAD_NAME,
	buildFeedbackEmbed,
	clip,
	embedLength,
	isRetryable,
	retryAfterSeconds,
	retryDelayMs,
	threadName,
	type FeedbackReport
} from './notifyShared';

const REPORT: FeedbackReport = {
	feedbackId: 'k1728abcdefghijklmnopqrstuv',
	category: 'bug',
	title: 'Diff view goes blank on a large file',
	body: 'Opening a 12k line file blanks the pane.',
	appVersion: '0.1.4',
	platform: 'darwin',
	osRelease: '24.3.0',
	arch: 'arm64',
	electronVersion: '38.1.0'
};

describe('clip', () => {
	it('leaves text alone under the limit and ellipsizes over it', () => {
		expect(clip('short', 10)).toBe('short');
		expect(clip('abcdefghij', 5)).toBe('abcd…');
		expect(clip('abcdefghij', 5)).toHaveLength(5);
	});

	it('returns nothing when there is no room, rather than a negative slice', () => {
		expect(clip('abc', 0)).toBe('');
		expect(clip('abc', -10)).toBe('');
	});
});

describe('buildFeedbackEmbed', () => {
	it('carries the report, the system detail and the row id', () => {
		const embed = buildFeedbackEmbed(REPORT);
		expect(embed.title).toBe(REPORT.title);
		expect(embed.description).toBe(REPORT.body);
		expect(embed.footer.text).toBe(REPORT.feedbackId);
		expect(embed.author.name).toBe('Anonymous');
		expect(embed.fields.find((f) => f.name === 'System')?.value).toBe(
			'darwin/arm64 · OS 24.3.0 · Electron 38.1.0'
		);
		expect(embed.fields.find((f) => f.name === 'Plan')?.value).toBe('not signed in');
	});

	it('names the reporter and their license when the report is attributed', () => {
		const embed = buildFeedbackEmbed({
			...REPORT,
			reporterName: 'Ada',
			reporterEmail: 'ada@example.com',
			reporterImage: 'https://example.com/ada.png',
			plan: 'lifetime',
			status: 'active'
		});
		expect(embed.author).toEqual({ name: 'Ada', icon_url: 'https://example.com/ada.png' });
		expect(embed.fields.find((f) => f.name === 'Plan')?.value).toBe('lifetime (active)');
	});

	it('adds a reply-to only when it differs from the account email', () => {
		const same = buildFeedbackEmbed({
			...REPORT,
			email: 'ada@example.com',
			reporterEmail: 'ada@example.com'
		});
		expect(same.fields.some((f) => f.name === 'Reply to')).toBe(false);

		const different = buildFeedbackEmbed({
			...REPORT,
			email: 'other@example.com',
			reporterEmail: 'ada@example.com'
		});
		expect(different.fields.find((f) => f.name === 'Reply to')?.value).toBe('other@example.com');
	});

	it('includes only the context lines that were captured', () => {
		const embed = buildFeedbackEmbed({
			...REPORT,
			context: { action: 'open diff', repo: 'acme/site' }
		});
		const context = embed.fields.find((f) => f.name === 'Context')?.value ?? '';
		expect(context).toContain('Action:   open diff');
		expect(context).toContain('Repo:     acme/site');
		expect(context).not.toContain('Branch:');
	});

	it('stays inside the 6000 character embed ceiling that rejects the whole message', () => {
		// Every field maxed out at once. Each one is individually legal, so only
		// the total catches this; without the trim Discord answers 400 and the
		// report reaches neither the channel nor a thread.
		const embed = buildFeedbackEmbed({
			...REPORT,
			title: 'T'.repeat(500),
			body: 'B'.repeat(10_000),
			email: `${'e'.repeat(300)}@example.com`,
			reporterName: 'N'.repeat(500),
			reporterEmail: 'ada@example.com',
			appVersion: 'v'.repeat(2000),
			platform: 'p'.repeat(2000),
			osRelease: 'o'.repeat(2000),
			electronVersion: 'e'.repeat(2000),
			plan: 'lifetime',
			status: 'active',
			context: {
				action: 'a'.repeat(500),
				tab: 't'.repeat(500),
				repo: 'r'.repeat(500),
				branch: 'b'.repeat(500),
				location: 'l'.repeat(500)
			}
		});
		expect(embedLength(embed)).toBeLessThanOrEqual(MAX_EMBED_TOTAL);
		// The body is what gets shortened, and it is still the bulk of the embed.
		expect(embed.description.length).toBeGreaterThan(500);
	});
});

describe('threadName', () => {
	it('prefixes the category so the channel list is scannable', () => {
		expect(threadName('bug', 'Diff view blanks')).toBe('🐛 Bug Diff view blanks');
		expect(threadName('idea', 'Add vim keys')).toBe('💡 Idea Add vim keys');
	});

	it('never exceeds the Discord thread name limit', () => {
		expect(threadName('other', 'x'.repeat(500))).toHaveLength(MAX_THREAD_NAME);
	});
});

describe('isRetryable', () => {
	it('retries rate limits, Discord outages and network failures', () => {
		expect(isRetryable(429)).toBe(true);
		expect(isRetryable(500)).toBe(true);
		expect(isRetryable(503)).toBe(true);
		expect(isRetryable('threw')).toBe(true);
	});

	it('does not retry a misconfiguration, which stays broken until it is fixed', () => {
		expect(isRetryable(400)).toBe(false); // payload Discord refuses
		expect(isRetryable(401)).toBe(false); // bad bot token
		expect(isRetryable(403)).toBe(false); // no access, or no Create Public Threads
		expect(isRetryable(404)).toBe(false); // channel id points at nothing
	});
});

describe('retryDelayMs', () => {
	it('backs off exponentially and caps', () => {
		expect(retryDelayMs(1)).toBe(30_000);
		expect(retryDelayMs(2)).toBe(60_000);
		expect(retryDelayMs(3)).toBe(120_000);
		expect(retryDelayMs(99)).toBe(15 * 60_000);
	});

	it('never retries sooner than Discord asked on a 429', () => {
		expect(retryDelayMs(1, 120)).toBe(120_000);
		expect(retryDelayMs(1, 5)).toBe(30_000);
	});
});

describe('retryAfterSeconds', () => {
	it('reads the rate limit hint out of the error body', () => {
		expect(retryAfterSeconds({ retry_after: 1.5 })).toBe(1.5);
		expect(retryAfterSeconds({ message: 'Missing Permissions', code: 50013 })).toBeUndefined();
		expect(retryAfterSeconds(null)).toBeUndefined();
	});
});
