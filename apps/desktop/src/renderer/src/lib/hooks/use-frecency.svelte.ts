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
};

export class UseFrecency {
  #items: PersistedState<FrecencyMap>;

  constructor(
    key: string,
    initialValue: FrecencyMap = {},
    readonly opts: UseFrecencyOptions = {},
  ) {
    this.#items = new PersistedState<FrecencyMap>(key, initialValue, this.opts);
    this.use = this.use.bind(this);
  }

  use(key: string): void {
    const item = this.#items.current[key];
    this.#items.current[key] = {
      uses: 1 + (item?.uses ?? 0),
      lastUsage: Date.now(),
    };
  }

  get items(): string[] {
    return Array.from(Object.entries(this.#items.current))
      .filter(([, a]) => a !== undefined)
      .sort(([, a], [, b]) => {
        if (a!.uses > b!.uses) return -1;
        if (b!.uses > a!.uses) return 1;
        return a!.lastUsage - b!.lastUsage;
      })
      .slice(0, this.opts.maxItems)
      .map(([key]) => key);
  }

  clear(): void {
    this.#items.current = {};
  }
}
