// Static auth instance used only by `npx @better-auth/cli generate` to derive
// the component schema (schema.ts). Not imported by runtime code.
import { createAuth } from '../auth';

export const auth = createAuth({} as never);
