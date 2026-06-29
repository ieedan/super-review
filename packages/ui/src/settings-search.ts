import {
	HOTKEY_ACTIONS,
	HOTKEY_LABELS,
	type HotkeyAction
} from '@super-review/core/hotkeys';

type SettingsTabId =
	| 'accounts'
	| 'appearance'
	| 'behavior'
	| 'app'
	| 'editor'
	| 'hotkeys'
	| 'stats';

/** DOM id suffix for `settings-<id>` scroll targets inside SettingsDialog. */
export type SettingsSectionId =
	| 'github-accounts'
	| 'theme'
	| 'accent'
	| 'ui-font'
	| 'code-font'
	| 'diff-view'
	| 'diff-theme'
	| 'diff-layout'
	| 'file-icons'
	| 'animations'
	| 'arrow-navigation'
	| 'merged-branches'
	| 'reviewing'
	| 'commits'
	| 'recent-repositories'
	| 'large-diffs'
	| 'hidden-files'
	| 'custom-file-icons'
	| 'window-size'
	| 'start-maximized'
	| 'external-editor'
	| 'terminal'
	| 'changesets'
	| 'hotkeys'
	| `hotkey-${HotkeyAction}`;

export interface SettingsSearchEntry {
	id: SettingsSectionId;
	tab: SettingsTabId;
	tabLabel: string;
	title: string;
	/** Lowercase text used for matching (title, description, aliases). */
	keywords: string;
	description: string;
}

const TAB_LABELS: Record<SettingsTabId, string> = {
	accounts: 'Accounts',
	appearance: 'Appearance',
	behavior: 'Behavior',
	app: 'App',
	editor: 'Integrations',
	hotkeys: 'Hotkeys',
	stats: 'Stats'
};

const STATIC_ENTRIES: SettingsSearchEntry[] = [
	{
		id: 'github-accounts',
		tab: 'accounts',
		tabLabel: TAB_LABELS.accounts,
		title: 'GitHub accounts',
		keywords:
			'github accounts sign in login auth authentication default account pull requests comments',
		description: 'Sign in to review pull requests and post comments.'
	},
	{
		id: 'theme',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'Theme',
		keywords: 'theme light dark appearance color mode',
		description: 'Choose a light or dark appearance.'
	},
	{
		id: 'accent',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'Accent',
		keywords: 'accent color primary buttons highlights links focus rings',
		description: 'Color for primary buttons, highlights, links, and focus rings.'
	},
	{
		id: 'ui-font',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'UI font',
		keywords: 'ui font typography sidebar lists app chrome interface typeface',
		description: 'Font used for the sidebar, lists, and app chrome.'
	},
	{
		id: 'code-font',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'Code font',
		keywords: 'code font monospace diff typography typeface',
		description: 'Font used for diffs and code.'
	},
	{
		id: 'diff-view',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'Diff view',
		keywords: 'diff view split unified side by side changes display',
		description: 'Choose how changes are displayed.'
	},
	{
		id: 'diff-theme',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'Diff theme',
		keywords: 'diff theme syntax highlighting code blocks pierre',
		description: 'Syntax highlighting theme for diff code blocks.'
	},
	{
		id: 'diff-layout',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'Diff layout',
		keywords: 'diff layout scrollable one at a time single file github desktop',
		description: 'Scroll all file diffs or show one file at a time.'
	},
	{
		id: 'file-icons',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'File icons',
		keywords: 'file icons sidebar language icons shown hidden',
		description: 'Show language-specific icons next to file names.'
	},
	{
		id: 'animations',
		tab: 'appearance',
		tabLabel: TAB_LABELS.appearance,
		title: 'Animations',
		keywords: 'animations motion ui transitions menus dialogs tooltips accents',
		description: 'How much motion the UI uses.'
	},
	{
		id: 'arrow-navigation',
		tab: 'behavior',
		tabLabel: TAB_LABELS.behavior,
		title: 'Arrow-key navigation',
		keywords: 'arrow keys navigation sidebar open enter keyboard cursor file',
		description: 'What happens when you arrow onto a file in the sidebar.'
	},
	{
		id: 'merged-branches',
		tab: 'behavior',
		tabLabel: TAB_LABELS.behavior,
		title: 'Merged branches',
		keywords:
			'merged branches pull request pr switch default delete remove local auto',
		description: 'What to do when a checked-out branch PR is merged.'
	},
	{
		id: 'reviewing',
		tab: 'behavior',
		tabLabel: TAB_LABELS.behavior,
		title: 'Reviewing',
		keywords: 'reviewing seen files unmark change mark review',
		description: 'How the review view tracks files you have looked at.'
	},
	{
		id: 'commits',
		tab: 'behavior',
		tabLabel: TAB_LABELS.behavior,
		title: 'Commits',
		keywords: 'commits sign signing ssh verified github',
		description: 'How commits you make in Super Review are signed.'
	},
	{
		id: 'recent-repositories',
		tab: 'behavior',
		tabLabel: TAB_LABELS.behavior,
		title: 'Recent repositories',
		keywords: 'recent repositories repo picker history',
		description: 'How many recently opened repositories the picker lists.'
	},
	{
		id: 'large-diffs',
		tab: 'behavior',
		tabLabel: TAB_LABELS.behavior,
		title: 'Large diffs',
		keywords: 'large diffs load diff size limit changed lines defer',
		description: 'Hide very large diffs behind a Load diff button.'
	},
	{
		id: 'hidden-files',
		tab: 'behavior',
		tabLabel: TAB_LABELS.behavior,
		title: 'Hidden files',
		keywords: 'hidden files glob patterns lock files build outputs defer load diff',
		description: 'Glob patterns for files whose diffs are hidden by default.'
	},
	{
		id: 'custom-file-icons',
		tab: 'behavior',
		tabLabel: TAB_LABELS.behavior,
		title: 'Custom file icons',
		keywords: 'custom file icons glob pattern image svg url',
		description: 'Give files matching a glob pattern your own icon.'
	},
	{
		id: 'window-size',
		tab: 'app',
		tabLabel: TAB_LABELS.app,
		title: 'Window size',
		keywords: 'window size width height pixels launch startup',
		description: 'The size the window opens at, in pixels.'
	},
	{
		id: 'start-maximized',
		tab: 'app',
		tabLabel: TAB_LABELS.app,
		title: 'Start maximized',
		keywords: 'start maximized fullscreen full screen launch startup window',
		description: 'Open the window maximized on launch.'
	},
	{
		id: 'external-editor',
		tab: 'editor',
		tabLabel: TAB_LABELS.editor,
		title: 'External editor',
		keywords:
			'external editor open cursor vscode visual studio code zed xcode integration',
		description: 'Used by the Open in editor button.'
	},
	{
		id: 'terminal',
		tab: 'editor',
		tabLabel: TAB_LABELS.editor,
		title: 'Terminal',
		keywords: 'terminal open iterm warp ghostty command prompt powershell integration',
		description: 'Used by the Open in terminal button.'
	},
	{
		id: 'changesets',
		tab: 'editor',
		tabLabel: TAB_LABELS.editor,
		title: 'Changesets',
		keywords: 'changesets integration commit message autofill',
		description: 'Optional changesets integration for specific repos.'
	},
	{
		id: 'hotkeys',
		tab: 'hotkeys',
		tabLabel: TAB_LABELS.hotkeys,
		title: 'Keyboard shortcuts',
		keywords: 'keyboard shortcuts hotkeys bindings keys',
		description: 'Customize keyboard shortcuts.'
	}
];

const HOTKEY_ENTRIES: SettingsSearchEntry[] = HOTKEY_ACTIONS.map((action) => {
	const { label, description } = HOTKEY_LABELS[action];
	return {
		id: `hotkey-${action}`,
		tab: 'hotkeys',
		tabLabel: TAB_LABELS.hotkeys,
		title: label,
		keywords: `${label} ${description} hotkey shortcut keyboard`.toLowerCase(),
		description
	};
});

const SEARCH_INDEX: SettingsSearchEntry[] = [...STATIC_ENTRIES, ...HOTKEY_ENTRIES];

function entryHaystack(entry: SettingsSearchEntry): string {
	return `${entry.title} ${entry.keywords} ${entry.description} ${entry.tabLabel}`.toLowerCase();
}

/** Return settings entries whose title/keywords match every whitespace-separated query word. */
export function searchSettings(query: string): SettingsSearchEntry[] {
	const words = query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return [];

	return SEARCH_INDEX.filter((entry) => {
		const haystack = entryHaystack(entry);
		return words.every((word) => haystack.includes(word));
	});
}
