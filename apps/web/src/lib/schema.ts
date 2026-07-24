import { z } from 'zod';

// Client-side mirror of the validation in `convex/waitlist.ts`. It exists to
// show an inline error before a round trip; the Convex mutation re-validates and
// is what actually guards the table.
export const waitlistSchema = z.object({
	email: z.email('Enter a valid email address.').max(254, 'That email is too long.')
});

export type WaitlistSchema = typeof waitlistSchema;
