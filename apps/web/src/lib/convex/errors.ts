import { ConvexError as ConvexErrorType } from 'convex/values';
import * as errf from 'errf';
import { type FunctionReference, getFunctionName } from 'convex/server';

export const convexError = errf.create({
	Unauthorized: {
		code: 'UNAUTHORIZED',
		message: 'Unauthorized',
		userMessage: 'You are not authorized, please login to continue'
	},
	InvalidSecretError: {
		code: 'INVALID_SECRET_ERROR',
		message: 'Invalid secret'
	},
	LaunchWindowClosed: {
		code: 'LAUNCH_WINDOW_CLOSED',
		message: 'The perpetual launch deal is no longer available',
		userMessage: 'The perpetual launch deal is no longer available'
	},
	AlreadyLifetime: {
		code: 'ALREADY_LIFETIME',
		message: 'This account already has a perpetual license',
		userMessage: 'You already own a perpetual license'
	},
	RateLimited: {
		code: 'RATE_LIMITED',
		message: 'Rate limit exceeded',
		userMessage: 'Too many requests, please try again later'
	},
	InvalidEmail: {
		code: 'INVALID_EMAIL',
		message: 'Invalid email address',
		userMessage: 'Enter a valid email address.'
	},
	// One error for every redemption failure (unknown, revoked, already used) so
	// the response cannot be used to map the code space.
	InvalidInviteCode: {
		code: 'INVALID_INVITE_CODE',
		message: 'Invalid, revoked, or already redeemed invite code',
		userMessage: "That code isn't valid. Check it and try again."
	},
	// Invites only exist to gate a closed beta. Once waitlist mode is off the app
	// is open to everyone, so a code has nothing left to grant.
	InviteCodesClosed: {
		code: 'INVITE_CODES_CLOSED',
		message: 'Invite codes are no longer redeemable',
		userMessage: "The beta has ended - you don't need an invite code any more."
	},
	// Closed beta: Stripe Checkout must not open for accounts that have not
	// redeemed an invite while waitlist mode is on.
	WaitlistRequired: {
		code: 'WAITLIST_REQUIRED',
		message: 'An invite is required before purchasing',
		userMessage: 'Redeem an invite code before upgrading.'
	},
	InvalidFeedback: {
		code: 'INVALID_FEEDBACK',
		message: 'Feedback needs a title and a body',
		userMessage: 'Add a title and some details before sending.'
	},
	InvalidActivationCode: {
		code: 'INVALID_ACTIVATION_CODE',
		message: 'Invalid, expired, or already used activation code'
	},
	ActivationCodeCollision: {
		code: 'ACTIVATION_CODE_COLLISION',
		message: 'Generated code collided with a pending one; retry'
	},
	UnknownError: {
		code: '002_CONVEX_API_ERROR',
		message: (opts: {
			reference: AnyFunctionReference;
			type: 'query' | 'mutation' | 'action';
			message?: string;
		}) => {
			const referenceName = getFunctionName(opts.reference);

			return `Convex ${opts.type} error: ${referenceName} ${opts.message ? `- ${opts.message}` : ''}`;
		}
	}
});

type AnyFunctionReference = Parameters<typeof getFunctionName>[0];

export type ConvexError<K extends keyof typeof convexError> = errf.InferError<
	typeof convexError,
	K
>;

export type AnyConvexError = errf.InferAnyError<typeof convexError>;

export type ConvexErrorCode = errf.InferErrorCodes<typeof convexError>;

export function createConvexError(error: AnyConvexError): ConvexErrorType<never> {
	return new ConvexErrorType(error as never);
}

export function intoConvexError<T extends 'action' | 'query' | 'mutation'>(
	reference: FunctionReference<T>,
	cause: unknown,
	type: T
): AnyConvexError {
	if (cause instanceof ConvexErrorType) {
		// Guard that data is an object: some ConvexErrors (e.g. better-auth's
		// `Unauthenticated`) carry a plain string as `data`, and `'code' in <string>`
		// throws a TypeError.
		if (cause.data && typeof cause.data === 'object' && 'code' in cause.data) {
			return cause.data as AnyConvexError;
		}
	}
	return convexError.UnknownError(
		{
			reference,
			type,
			message: cause instanceof Error ? cause.message : undefined
		},
		cause instanceof Error ? cause : undefined
	);
}
