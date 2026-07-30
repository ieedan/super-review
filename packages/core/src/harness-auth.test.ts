import { describe, expect, it } from 'vitest';
import { explainAuthFailure, looksLikeAuthFailure, stripAnsi } from './harness-auth.js';
import { harnessLoginHint, harnessLoginRecipe } from './types.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe('stripAnsi', () => {
	it('drops SGR color runs', () => {
		expect(stripAnsi(`${ESC}[31mNot logged in${ESC}[0m`)).toBe('Not logged in');
	});

	it('drops cursor-move and erase-line sequences, which do not end in m', () => {
		expect(stripAnsi(`${ESC}[2K${ESC}[GLoading models…${ESC}[1A`)).toBe('Loading models…');
	});

	it('drops OSC strings terminated by BEL or ST', () => {
		expect(stripAnsi(`${ESC}]0;title${BEL}ready`)).toBe('ready');
		expect(stripAnsi(`${ESC}]8;;http://x${ESC}\\link`)).toBe('link');
	});

	it('drops a truncated escape left by a killed process', () => {
		expect(stripAnsi(`exit code 1${ESC}[22`)).toBe('exit code 1');
	});

	it('leaves plain text alone', () => {
		expect(stripAnsi('feat: add a thing')).toBe('feat: add a thing');
	});
});

describe('looksLikeAuthFailure', () => {
	// The exact strings these CLIs actually print. The Claude Code one is the
	// failure that motivated this whole path.
	it.each([
		'Failed to authenticate: OAuth session expired and could not be refreshed',
		'Not logged in. Run `codex login` to sign in.',
		'error: Unauthorized',
		'HTTP 401',
		'status code 403',
		'401 Unauthorized',
		'Authentication failed',
		'Please log in to continue',
		'invalid api key',
		'Your session has expired',
		'You are not authenticated',
		'Run `opencode auth login` to add a provider'
	])('flags %j', (raw) => {
		expect(looksLikeAuthFailure(raw)).toBe(true);
	});

	it('sees through ANSI color', () => {
		expect(looksLikeAuthFailure(`${ESC}[1;31mNot logged in${ESC}[0m`)).toBe(true);
	});

	// The whole point of keeping the patterns tight: re-coding one of these as an
	// auth failure would send the user off to fix a login that is already fine.
	it.each([
		'Timed out after 90s',
		'429 Too Many Requests',
		'rate limit exceeded',
		'500 Internal Server Error',
		'503 Service Unavailable',
		'Your credit balance is too low',
		'model gpt-9 not found',
		'ENOENT: no such file or directory',
		'The agent returned an empty response.',
		'Cancelled'
	])('does not flag %j', (raw) => {
		expect(looksLikeAuthFailure(raw)).toBe(false);
	});

	it('does not flag empty or absent output', () => {
		expect(looksLikeAuthFailure('')).toBe(false);
		expect(looksLikeAuthFailure('   \n  ')).toBe(false);
		expect(looksLikeAuthFailure(undefined)).toBe(false);
		expect(looksLikeAuthFailure(null)).toBe(false);
	});
});

describe('explainAuthFailure', () => {
	it('names the harness and the command, and keeps the CLI text as detail', () => {
		const message = explainAuthFailure(
			'claude-code',
			'Failed to authenticate: OAuth session expired and could not be refreshed'
		);
		expect(message).toContain('Claude Code');
		expect(message).toContain('claude');
		expect(message).toContain('/login');
		expect(message).toContain('OAuth session expired');
	});

	it('works with no CLI output at all (nothing ran)', () => {
		const message = explainAuthFailure('codex');
		expect(message).toBe(
			"Codex isn't signed in. To fix it, run `codex login` in a terminal, then try again."
		);
	});

	it('drops a redundant leading "Error:" label from the detail', () => {
		expect(explainAuthFailure('cursor', 'Error: Unauthorized')).toContain('\n\nUnauthorized');
	});
});

describe('harness login recipes', () => {
	// Every harness needs a recipe, or the recovery affordance renders a blank
	// command and the user is back where they started.
	it.each(['claude-code', 'cursor', 'codex', 'copilot', 'opencode'] as const)(
		'%s has a non-empty command',
		(harness) => {
			expect(harnessLoginRecipe(harness).command.trim().length).toBeGreaterThan(0);
			expect(harnessLoginHint(harness)).toContain(harnessLoginRecipe(harness).command);
		}
	);

	it('spells out the second step for the CLIs that need one', () => {
		expect(harnessLoginHint('claude-code')).toBe('run `claude`, then `/login`');
		expect(harnessLoginHint('opencode')).toBe('run `opencode auth login`');
	});
});
