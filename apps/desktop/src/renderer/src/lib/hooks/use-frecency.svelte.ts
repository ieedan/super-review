import { PersistedState } from 'runed';

// Vendored from shadcn-svelte-extras (ieedan/shadcn-svelte-extras,
// content/hooks/use-frecency.md). Tracks per-key uses + lastUsage in
// localStorage and exposes the keys ordered by frecency.

type FrecencyItem = {
	uses: number;
	lastUsage: number;
};

type PersistedStateOptions<T> = ConstructorParameters<typeof PersistedState<T>>[2];

type FrecencyMap = Record<string, FrecencyItem | undefined>;

type UseFrecencyOptions = PersistedStateOptions<FrecencyMap> & {
	maxItems?: number;
	/**
	 * Recency half-life in milliseconds. An item's frequency weight decays by
	 * half once this much time has passed since its last use, so an old
	 * all-time favourite eventually ranks below something used recently.
	 * Defaults to 3 days.
	 */
	halfLife?: number;
};

// Long enough that a repo you reach for daily stays near the top, short enough
// that one you've abandoned for a week slides down even if its lifetime count
// is high.
const DEFAULT_HALF_LIFE = 1000 * 60 * 60 * 24 * 3; // 3 days

export class UseFrecency {
	#items: PersistedState<FrecencyMap>;

	constructor(
		key: string,
		initialValue: FrecencyMap = {},
		readonly opts: UseFrecencyOptions = {}
	) {
		this.#items = new PersistedState<FrecencyMap>(key, initialValue, this.opts);
		this.use = this.use.bind(this);
	}

	use(key: string): void {
		const item = this.#items.current[key];
		this.#items.current[key] = {
			uses: 1 + (item?.uses ?? 0),
			lastUsage: Date.now()
		};
	}

	// Blend frequency and recency: the lifetime use count is the base weight,
	// scaled down by exponential decay on how long ago the item was last used.
	// Two uses today beat fifty uses from a month ago.
	#score(item: FrecencyItem, now: number): number {
		const age = Math.max(0, now - item.lastUsage);
		const halfLife = this.opts.halfLife ?? DEFAULT_HALF_LIFE;
		return item.uses * Math.pow(0.5, age / halfLife);
	}

	get items(): string[] {
		const now = Date.now();
		return Array.from(Object.entries(this.#items.current))
			.filter((entry): entry is [string, FrecencyItem] => entry[1] !== undefined)
			.sort(([, a], [, b]) => this.#score(b, now) - this.#score(a, now))
			.slice(0, this.opts.maxItems)
			.map(([key]) => key);
	}

	clear(): void {
		this.#items.current = {};
	}
}
