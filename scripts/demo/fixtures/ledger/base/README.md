# Ledger

Split shared expenses without doing arithmetic at the dinner table.

Log what everyone spent, and Ledger keeps a running balance for each person in
the group. Nobody has to remember who covered the taxi.

## Running it

```sh
pnpm install
pnpm dev
```

## How money works here

Every amount in this codebase is an **integer number of cents**. There are no
float amounts anywhere, because a float cannot represent `0.10` exactly and
three of them do not sum to `0.30`. Formatting to a human-readable string is
the last thing that happens, in `formatAmount`.

If you are adding a feature that touches money, keep it in cents until it hits
the screen.

## Layout

| Path                     | What lives there                                  |
| ------------------------ | ------------------------------------------------- |
| `src/lib/types.ts`       | The data model: groups, members, expenses, splits |
| `src/lib/money.ts`       | Cent helpers and display formatting               |
| `src/lib/split.ts`       | How an expense total is divided among members     |
| `src/lib/store.svelte.ts`| App state                                         |
| `src/lib/db.ts`          | Persistence (localStorage, for now)               |
| `tests/`                 | Vitest specs for the money and split logic        |
