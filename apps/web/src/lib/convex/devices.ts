import { v } from 'convex/values';
import { mutation } from './utils';
import { authComponent } from './auth';
import { convexError, createConvexError } from './errors';

/** Dashboard "revoke device": revokes the device and all its tokens. Authed to
 * the signed-in user, who must own the device's license. */
export const revoke = mutation({
	args: { deviceId: v.id('devices') },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw createConvexError(convexError.Unauthorized());

		const device = await ctx.db.get(args.deviceId);
		if (!device) return;
		const license = await ctx.db.get(device.licenseId);
		if (!license || license.userId !== user._id) {
			throw createConvexError(convexError.Unauthorized());
		}

		const now = Date.now();
		await ctx.db.patch(device._id, { revokedAt: now });
		const tokens = await ctx.db
			.query('deviceTokens')
			.withIndex('by_deviceId', (q) => q.eq('deviceId', device._id))
			.collect();
		for (const token of tokens) {
			if (!token.revokedAt) await ctx.db.patch(token._id, { revokedAt: now });
		}
	}
});
