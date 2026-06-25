import { z } from 'zod';

// Shared by the client form (SuperForms validators) and the server endpoint, so
// validation lives in exactly one place.
export const waitlistSchema = z.object({
	email: z.email('Enter a valid email address.').max(254, 'That email is too long.')
});

export type WaitlistSchema = typeof waitlistSchema;
