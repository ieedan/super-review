import { defineApp } from 'convex/server';
import betterAuth from './betterAuth/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';

const app = defineApp();
// Local install of the better-auth component (vendored in ./betterAuth) so its
// schema can include plugin tables (the Stripe plugin's subscription model).
app.use(betterAuth);
app.use(rateLimiter);

export default app;
