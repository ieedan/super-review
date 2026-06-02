// Map a file path to a Material Icon Theme icon name. Icons are bundled with
// the app via @iconify-json/material-icon-theme and registered eagerly at
// module load — the renderer's CSP blocks calls to the Iconify API, so we use
// the offline pathway. Pair with <OfflineIcon icon={...} /> from
// @iconify/svelte/dist/OfflineIcon.svelte.
import { addCollection } from '@iconify/svelte/dist/OfflineIcon.svelte';
import { icons as materialIconTheme } from '@iconify-json/material-icon-theme';

addCollection(materialIconTheme);

// Names actually present in the bundled collection. The offline <Icon> renders
// nothing (a blank gap) when handed a name that isn't here, so we validate every
// resolved name against this set and fall back to the generic file icon instead.
const AVAILABLE_ICONS = new Set<string>([
	...Object.keys(materialIconTheme.icons),
	...Object.keys(materialIconTheme.aliases ?? {})
]);

const EXACT_NAMES: Record<string, string> = {
	dockerfile: 'material-icon-theme:docker',
	'docker-compose.yml': 'material-icon-theme:docker',
	'docker-compose.yaml': 'material-icon-theme:docker',
	'.dockerignore': 'material-icon-theme:docker',
	'readme.md': 'material-icon-theme:readme',
	readme: 'material-icon-theme:readme',
	license: 'material-icon-theme:certificate',
	'license.md': 'material-icon-theme:certificate',
	'license.txt': 'material-icon-theme:certificate',
	'.gitignore': 'material-icon-theme:git',
	'.gitattributes': 'material-icon-theme:git',
	'.gitmodules': 'material-icon-theme:git',
	'.env': 'material-icon-theme:tune',
	'.env.local': 'material-icon-theme:tune',
	'.env.development': 'material-icon-theme:tune',
	'.env.production': 'material-icon-theme:tune',
	'.editorconfig': 'material-icon-theme:editorconfig',
	'.prettierrc': 'material-icon-theme:prettier',
	'.prettierrc.json': 'material-icon-theme:prettier',
	'.prettierrc.js': 'material-icon-theme:prettier',
	'prettier.config.js': 'material-icon-theme:prettier',
	'.eslintrc': 'material-icon-theme:eslint',
	'.eslintrc.js': 'material-icon-theme:eslint',
	'.eslintrc.json': 'material-icon-theme:eslint',
	'eslint.config.js': 'material-icon-theme:eslint',
	'package.json': 'material-icon-theme:nodejs',
	'package-lock.json': 'material-icon-theme:nodejs',
	'pnpm-lock.yaml': 'material-icon-theme:pnpm',
	'pnpm-workspace.yaml': 'material-icon-theme:pnpm',
	'yarn.lock': 'material-icon-theme:yarn',
	'bun.lockb': 'material-icon-theme:bun',
	'tsconfig.json': 'material-icon-theme:tsconfig',
	'tsconfig.node.json': 'material-icon-theme:tsconfig',
	'tsconfig.web.json': 'material-icon-theme:tsconfig',
	'svelte.config.js': 'material-icon-theme:svelte',
	'svelte.config.ts': 'material-icon-theme:svelte',
	'vite.config.ts': 'material-icon-theme:vite',
	'vite.config.js': 'material-icon-theme:vite',
	'vitest.config.ts': 'material-icon-theme:vitest',
	'tailwind.config.js': 'material-icon-theme:tailwindcss',
	'tailwind.config.ts': 'material-icon-theme:tailwindcss',
	'postcss.config.js': 'material-icon-theme:postcss',
	'webpack.config.js': 'material-icon-theme:webpack',
	'rollup.config.js': 'material-icon-theme:rollup',
	'electron.vite.config.ts': 'material-icon-theme:vite',
	'components.json': 'material-icon-theme:json',
	makefile: 'material-icon-theme:makefile',
	'cargo.toml': 'material-icon-theme:rust',
	'cargo.lock': 'material-icon-theme:rust',
	'go.mod': 'material-icon-theme:go-mod',
	'go.sum': 'material-icon-theme:go-mod'
};

const EXTENSIONS: Record<string, string> = {
	// TypeScript / JavaScript
	ts: 'material-icon-theme:typescript',
	tsx: 'material-icon-theme:react-ts',
	cts: 'material-icon-theme:typescript',
	mts: 'material-icon-theme:typescript',
	'd.ts': 'material-icon-theme:typescript-def',
	js: 'material-icon-theme:javascript',
	jsx: 'material-icon-theme:react',
	cjs: 'material-icon-theme:javascript',
	mjs: 'material-icon-theme:javascript',

	// Frameworks
	svelte: 'material-icon-theme:svelte',
	vue: 'material-icon-theme:vue',
	astro: 'material-icon-theme:astro',

	// Data / config
	json: 'material-icon-theme:json',
	json5: 'material-icon-theme:json',
	jsonc: 'material-icon-theme:json',
	yml: 'material-icon-theme:yaml',
	yaml: 'material-icon-theme:yaml',
	toml: 'material-icon-theme:settings',
	xml: 'material-icon-theme:xml',
	ini: 'material-icon-theme:settings',
	env: 'material-icon-theme:tune',

	// Markup / docs
	md: 'material-icon-theme:markdown',
	mdx: 'material-icon-theme:mdx',
	html: 'material-icon-theme:html',
	htm: 'material-icon-theme:html',
	txt: 'material-icon-theme:document',
	rst: 'material-icon-theme:document',
	pdf: 'material-icon-theme:pdf',

	// Styles
	css: 'material-icon-theme:css',
	scss: 'material-icon-theme:sass',
	sass: 'material-icon-theme:sass',
	less: 'material-icon-theme:less',
	styl: 'material-icon-theme:stylus',
	pcss: 'material-icon-theme:postcss',
	'module.css': 'material-icon-theme:css',

	// Languages
	py: 'material-icon-theme:python',
	pyc: 'material-icon-theme:python',
	rb: 'material-icon-theme:ruby',
	go: 'material-icon-theme:go',
	rs: 'material-icon-theme:rust',
	java: 'material-icon-theme:java',
	kt: 'material-icon-theme:kotlin',
	kts: 'material-icon-theme:kotlin',
	swift: 'material-icon-theme:swift',
	c: 'material-icon-theme:c',
	h: 'material-icon-theme:h',
	cpp: 'material-icon-theme:cpp',
	cc: 'material-icon-theme:cpp',
	hpp: 'material-icon-theme:hpp',
	cs: 'material-icon-theme:csharp',
	fs: 'material-icon-theme:fsharp',
	php: 'material-icon-theme:php',
	dart: 'material-icon-theme:dart',
	ex: 'material-icon-theme:elixir',
	exs: 'material-icon-theme:elixir',
	erl: 'material-icon-theme:erlang',
	hs: 'material-icon-theme:haskell',
	lua: 'material-icon-theme:lua',
	pl: 'material-icon-theme:perl',
	r: 'material-icon-theme:r',
	scala: 'material-icon-theme:scala',
	zig: 'material-icon-theme:zig',
	nim: 'material-icon-theme:nim',
	ml: 'material-icon-theme:ocaml',

	// Shell
	sh: 'material-icon-theme:console',
	bash: 'material-icon-theme:console',
	zsh: 'material-icon-theme:console',
	fish: 'material-icon-theme:console',
	ps1: 'material-icon-theme:powershell',
	bat: 'material-icon-theme:console',
	cmd: 'material-icon-theme:console',

	// SQL / data
	sql: 'material-icon-theme:database',
	db: 'material-icon-theme:database',
	sqlite: 'material-icon-theme:database',
	csv: 'material-icon-theme:table',
	tsv: 'material-icon-theme:table',
	xlsx: 'material-icon-theme:table',
	parquet: 'material-icon-theme:table',

	// Images
	png: 'material-icon-theme:image',
	jpg: 'material-icon-theme:image',
	jpeg: 'material-icon-theme:image',
	gif: 'material-icon-theme:image',
	webp: 'material-icon-theme:image',
	bmp: 'material-icon-theme:image',
	ico: 'material-icon-theme:favicon',
	svg: 'material-icon-theme:svg',
	avif: 'material-icon-theme:image',

	// Media
	mp3: 'material-icon-theme:audio',
	wav: 'material-icon-theme:audio',
	flac: 'material-icon-theme:audio',
	ogg: 'material-icon-theme:audio',
	mp4: 'material-icon-theme:video',
	mov: 'material-icon-theme:video',
	webm: 'material-icon-theme:video',
	mkv: 'material-icon-theme:video',

	// Archives
	zip: 'material-icon-theme:zip',
	tar: 'material-icon-theme:zip',
	gz: 'material-icon-theme:zip',
	bz2: 'material-icon-theme:zip',
	'7z': 'material-icon-theme:zip',
	rar: 'material-icon-theme:zip',

	// Fonts
	ttf: 'material-icon-theme:font',
	otf: 'material-icon-theme:font',
	woff: 'material-icon-theme:font',
	woff2: 'material-icon-theme:font',

	// Misc
	lock: 'material-icon-theme:lock',
	log: 'material-icon-theme:log',
	graphql: 'material-icon-theme:graphql',
	gql: 'material-icon-theme:graphql',
	proto: 'material-icon-theme:proto',
	prisma: 'material-icon-theme:prisma'
};

const DEFAULT_ICON = 'material-icon-theme:document';

// Guard against names missing from the bundled collection (typos, icons not
// shipped in this theme version) — those render as a blank gap, so fall back to
// the generic file icon instead.
function ensureAvailable(icon: string): string {
	const bare = icon.slice(icon.indexOf(':') + 1);
	return AVAILABLE_ICONS.has(bare) ? icon : DEFAULT_ICON;
}

export function languageIconForPath(path: string): string {
	const name = path.split('/').pop()?.toLowerCase() ?? '';
	if (!name) return DEFAULT_ICON;

	if (EXACT_NAMES[name]) return ensureAvailable(EXACT_NAMES[name]);

	// Match compound extensions like `.d.ts` and `.module.css` before single ext.
	for (const ext of Object.keys(EXTENSIONS)) {
		if (ext.includes('.') && name.endsWith('.' + ext)) return ensureAvailable(EXTENSIONS[ext]);
	}

	const dot = name.lastIndexOf('.');
	if (dot <= 0) return DEFAULT_ICON;
	const ext = name.slice(dot + 1);
	return ensureAvailable(EXTENSIONS[ext] ?? DEFAULT_ICON);
}
