import {
	ConvexClient,
	ConvexHttpClient,
	type ConvexClientOptions,
	type HttpMutationOptions,
	type MutationOptions
} from 'convex/browser';
import {
	getFunctionName,
	type ArgsAndOptions,
	type FunctionArgs,
	type FunctionReference,
	type FunctionReturnType
} from 'convex/server';
import { ResultAsync } from 'nevereverthrow';
import { type AnyConvexError, intoConvexError } from '$lib/convex/errors';
import {
	setupConvex as setupConvexSvelte,
	useConvexClient as useConvexClientSvelte,
	useQuery as useQuerySvelte,
	useAuth as useAuthSvelte
} from 'convex-svelte';

export type AnyFunctionReference = Parameters<typeof getFunctionName>[0];

type SafeMethods = {
	safeAction: <Action extends FunctionReference<'action'>>(
		action: Action,
		args: FunctionArgs<Action>
	) => ResultAsync<Awaited<FunctionReturnType<Action>>, AnyConvexError>;
	safeMutation: <Mutation extends FunctionReference<'mutation'>>(
		mutation: Mutation,
		args: FunctionArgs<Mutation>,
		options?: MutationOptions & ArgsAndOptions<Mutation, HttpMutationOptions>[1]
	) => ResultAsync<Awaited<FunctionReturnType<Mutation>>, AnyConvexError>;
	safeQuery: <Query extends FunctionReference<'query'>>(
		query: Query,
		args: Query['_args']
	) => ResultAsync<Awaited<FunctionReturnType<Query>>, AnyConvexError>;
};

/**
 * Augments a Convex client with `safe*` variants that return `ResultAsync`
 * instead of throwing, while still exposing every method on the underlying
 * client (including auth-specific functionality like `setAuth`, `getAuth`,
 * `onUpdate`, `close`, `connectionState`) directly on the same instance.
 *
 * ```ts
 * const client = new SafeConvexClient(new ConvexClient(url));
 * client.setAuth(fetchToken);                // forwarded to ConvexClient
 * await client.safeQuery(api.foo.bar, {});   // wrapped, returns ResultAsync
 * ```
 *
 * The generic `T` is preserved per-instance so e.g. `onUpdate` is only
 * available when `T` is `ConvexClient`.
 */
export type SafeConvexClient<
	T extends ConvexClient | ConvexHttpClient = ConvexClient | ConvexHttpClient
> = T & SafeMethods;

/**
 * Builds a Proxy that forwards every property access to `client`, except for
 * the `safe*` names which it serves from `safeMethods`. Forwarded functions
 * are bound to `client` so internal `this`/private-field access keeps working.
 */
function wrapWithSafeMethods<T extends ConvexClient | ConvexHttpClient>(
	client: T,
	safeMethods: Record<string, unknown>
): T {
	return new Proxy(client, {
		get(target, prop) {
			if (typeof prop === 'string' && prop in safeMethods) {
				return safeMethods[prop];
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		has(target, prop) {
			if (typeof prop === 'string' && prop in safeMethods) return true;
			return Reflect.has(target, prop);
		}
	});
}

class SafeConvexClientImpl {
	constructor(client: ConvexClient | ConvexHttpClient) {
		const safe: SafeMethods = {
			safeAction: (action, args) =>
				ResultAsync.fromPromise(client.action(action, args), (e) =>
					intoConvexError(action, e, 'action')
				),
			safeMutation: (mutation, args, options) =>
				ResultAsync.fromPromise(client.mutation(mutation, args, options), (e) =>
					intoConvexError(mutation, e, 'mutation')
				),
			safeQuery: (query, args) =>
				ResultAsync.fromPromise(client.query(query, args), (e) =>
					intoConvexError(query, e, 'query')
				)
		};
		return wrapWithSafeMethods(client, safe as unknown as Record<string, unknown>) as never;
	}
}

export const SafeConvexClient = SafeConvexClientImpl as unknown as {
	new <T extends ConvexClient | ConvexHttpClient>(client: T): SafeConvexClient<T>;
};

type SecretMethods = {
	safeAction: <Action extends FunctionReference<'action'>>(
		action: Action,
		args: Omit<FunctionArgs<Action>, 'secret'>
	) => ResultAsync<Awaited<FunctionReturnType<Action>>, AnyConvexError>;
	safeMutation: <Mutation extends FunctionReference<'mutation'>>(
		mutation: Mutation,
		args: Omit<FunctionArgs<Mutation>, 'secret'>,
		options?: MutationOptions & ArgsAndOptions<Mutation, HttpMutationOptions>[1]
	) => ResultAsync<Awaited<FunctionReturnType<Mutation>>, AnyConvexError>;
	safeQuery: <Query extends FunctionReference<'query'>>(
		query: Query,
		args: Omit<Query['_args'], 'secret'>
	) => ResultAsync<Awaited<FunctionReturnType<Query>>, AnyConvexError>;
};

export type SecretClient<
	T extends ConvexClient | ConvexHttpClient = ConvexClient | ConvexHttpClient
> = T & SecretMethods;

class SecretClientImpl {
	constructor(client: ConvexClient | ConvexHttpClient, secret: string) {
		const safe: SecretMethods = {
			safeAction: (action, args) =>
				ResultAsync.fromPromise(client.action(action, { ...args, secret }), (e) =>
					intoConvexError(action, e, 'action')
				),
			safeMutation: (mutation, args, options) =>
				ResultAsync.fromPromise(client.mutation(mutation, { ...args, secret }, options), (e) =>
					intoConvexError(mutation, e, 'mutation')
				),
			safeQuery: (query, args) =>
				ResultAsync.fromPromise(client.query(query, { ...args, secret }), (e) =>
					intoConvexError(query, e, 'query')
				)
		};
		return wrapWithSafeMethods(client, safe as unknown as Record<string, unknown>) as never;
	}
}

export const SecretClient = SecretClientImpl as unknown as {
	new <T extends ConvexClient | ConvexHttpClient>(client: T, secret: string): SecretClient<T>;
};

export function setupConvex(
	url: string,
	options?: ConvexClientOptions
): SafeConvexClient<ConvexClient> {
	return new SafeConvexClient(setupConvexSvelte(url, options));
}

export function useConvexClient(): SafeConvexClient<ConvexClient> {
	return new SafeConvexClient(useConvexClientSvelte());
}

export { useQuerySvelte as useQuery, useAuthSvelte as useAuth };

import { untrack } from 'svelte';

export type Query<Q extends FunctionReference<'query'>> = ReturnType<typeof useQuerySvelte<Q>>;

export function useQueryWithFallback<Q extends FunctionReference<'query'>>(
	func: Q,
	args: NoInfer<Q['_args']>,
	opts: {
		fallback: Q['_returnType'];
	}
): Query<Q> {
	let fallback = $state(opts.fallback);
	const result = useQuerySvelte(func, args, {
		initialData: fallback
	});

	const data = $derived.by(() => {
		if (result.data) {
			untrack(() => (fallback = result.data));
		}
		return result.data ?? fallback;
	});

	return {
		...result,
		get data() {
			return data;
		}
	};
}
