// Turning a harness's tool calls into a line a person would write.
//
// While an agent works a branch out for itself, the only honest progress we have
// is what it is doing right now: which file it opened, what it searched for, what
// command it ran. Every CLI names its tools differently but they all bottom out
// in the same handful of verbs, so adapters hand the raw name and input here and
// get back one short line for the notice.

const MAX_STATUS = 60;

export interface ToolCall {
	/** The CLI's own tool name: `Read`, `read_file`, `bash`, `shell`, … */
	name: string;
	/** Its arguments, shape unknown; the fields we look for are all optional. */
	input?: unknown;
}

// A tool name reduced to what it does. Everything unrecognized stays null so the
// caller can fall back rather than narrating a tool nobody has heard of.
type Verb = 'read' | 'search' | 'list' | 'run' | 'write' | 'edit' | 'fetch' | 'think';

const VERBS: [RegExp, Verb][] = [
	[/^(read|read_file|view|open|cat|file_read)/i, 'read'],
	[/^(grep|search|codebase_search|ripgrep|find_text|glob|file_search)/i, 'search'],
	[/^(ls|list|list_dir|list_files|tree)/i, 'list'],
	[/^(bash|shell|run|exec|terminal|command|local_shell)/i, 'run'],
	[/^(write|create|new_file|file_write)/i, 'write'],
	[/^(edit|apply_patch|str_replace|multi_edit|patch|update_file)/i, 'edit'],
	[/^(fetch|web|url|browse|http)/i, 'fetch'],
	[/^(think|reason|plan|todo)/i, 'think']
];

function verbFor(name: string): Verb | null {
	for (const [re, verb] of VERBS) if (re.test(name)) return verb;
	return null;
}

// The first string in the tool input that looks like what the tool is acting on.
// Every CLI names this differently (`file_path`, `path`, `target_file`, `pattern`,
// `command`), so try the common keys and then any short string value.
function subjectOf(input: unknown, keys: string[]): string | null {
	if (!input || typeof input !== 'object') return null;
	const obj = input as Record<string, unknown>;
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

const PATH_KEYS = ['file_path', 'path', 'filePath', 'target_file', 'filename', 'file', 'abs_path'];
const QUERY_KEYS = ['pattern', 'query', 'search', 'regex', 'q'];
const COMMAND_KEYS = ['command', 'cmd', 'script', 'shell_command'];

// Last path segment: the reviewer knows their own repo, and the full path never
// fits on the notice line anyway.
function basename(p: string): string {
	const clean = p.replace(/[/\\]+$/, '');
	const cut = clean.lastIndexOf('/');
	const cutWin = clean.lastIndexOf('\\');
	return clean.slice(Math.max(cut, cutWin) + 1) || clean;
}

// Shell plumbing an agent uses to build up a command. Narrating these says
// nothing about the work, so a status for them is skipped entirely and whatever
// was on screen stays.
const SHELL_NOISE = new Set(['echo', 'printf', 'for', 'while', 'if', 'then', 'true', ':', 'cd']);
// Commands that are really just a file read, and read better said that way.
const READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'wc', 'nl']);
const SEARCH_COMMANDS = new Set(['grep', 'rg', 'ag', 'ack', 'find']);

// A shell command as a line about what the agent is doing. Null when the command
// is shell noise rather than work.
function describeCommand(command: string): string | null {
	// Take the first real command out of a pipeline/chain, and drop any leading
	// `FOO=bar` environment assignments.
	const first = command.split(/&&|\|\||[|;\n]/)[0]!.trim();
	const words = first.split(/\s+/).filter(Boolean);
	while (words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[0]!)) words.shift();

	const program = basename(words.shift() ?? '');
	if (!program || SHELL_NOISE.has(program)) return null;

	const args = words.filter((w) => !w.startsWith('-')).map(unquote);
	if (READ_COMMANDS.has(program)) {
		return args[0] ? `Reading ${basename(args[0])}` : 'Reading the code';
	}
	if (SEARCH_COMMANDS.has(program)) {
		return args[0] ? `Searching for ${truncate(args[0], 32)}` : 'Searching the code';
	}
	// `git diff`, `pnpm test`: the subcommand is the informative half. Everything
	// else is named by its first argument, shortened to a filename when it is one.
	const detail = args[0] ? (args[0].includes('/') ? basename(args[0]) : args[0]) : '';
	return detail ? `Running ${program} ${truncate(detail, 24)}` : `Running ${program}`;
}

function unquote(word: string): string {
	return word.replace(/^['"]+/, '').replace(/['"]+$/, '');
}

export function describeToolCall(call: ToolCall): string | null {
	const verb = verbFor(call.name);
	if (!verb) return null;

	switch (verb) {
		case 'read': {
			const path = subjectOf(call.input, PATH_KEYS);
			return path ? `Reading ${basename(path)}` : 'Reading the code';
		}
		case 'search': {
			const query = subjectOf(call.input, QUERY_KEYS);
			return query ? `Searching for ${truncate(query, 32)}` : 'Searching the code';
		}
		case 'list': {
			const path = subjectOf(call.input, PATH_KEYS);
			return path ? `Looking through ${basename(path)}` : 'Looking around the repo';
		}
		case 'run': {
			const command = subjectOf(call.input, COMMAND_KEYS);
			return command ? describeCommand(command) : 'Running a command';
		}
		case 'write': {
			const path = subjectOf(call.input, PATH_KEYS);
			return path ? `Writing ${basename(path)}` : 'Writing the changeset';
		}
		case 'edit': {
			const path = subjectOf(call.input, PATH_KEYS);
			return path ? `Editing ${basename(path)}` : 'Editing the changeset';
		}
		case 'fetch':
			return 'Reading the pull request';
		case 'think':
			return 'Thinking it through';
	}
}

function truncate(text: string, max: number): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Clamp any status line to something that fits the notice. */
export function clampStatus(status: string): string {
	return truncate(status, MAX_STATUS);
}
