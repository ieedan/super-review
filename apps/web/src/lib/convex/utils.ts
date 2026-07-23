import { customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import { query } from './_generated/server';
import { v } from 'convex/values';
import { internalMutation, mutation } from './triggers';
import type { GenericActionCtx, GenericQueryCtx } from 'convex/server';
import type { DataModel } from './_generated/dataModel';
import { env } from '../env.convex';
import { convexError, createConvexError } from './errors';

export const secretQuery = customQuery(query, {
	args: { secret: v.string() },
	input: verifySecret
});

export const secretMutation = customMutation(mutation, {
	args: { secret: v.string() },
	input: verifySecret
});

function verifySecret<
	QueryContext extends GenericQueryCtx<DataModel> | GenericActionCtx<DataModel>
>(ctx: QueryContext, args: { secret: string }) {
	if (args.secret !== env.FUNCTION_SECRET) {
		throw createConvexError(convexError.InvalidSecretError());
	}
	return {
		ctx,
		args: {}
	};
}

// make sure you import these functions when mutating data
export { mutation, internalMutation };
