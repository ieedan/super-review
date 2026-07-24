/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activation from "../activation.js";
import type * as adminReset from "../adminReset.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as crons from "../crons.js";
import type * as devices from "../devices.js";
import type * as email from "../email.js";
import type * as errors from "../errors.js";
import type * as feedback from "../feedback.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as licenses from "../licenses.js";
import type * as licensing from "../licensing.js";
import type * as licensingShared from "../licensingShared.js";
import type * as migrations from "../migrations.js";
import type * as notify from "../notify.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as settings from "../settings.js";
import type * as settingsShared from "../settingsShared.js";
import type * as triggers from "../triggers.js";
import type * as utils from "../utils.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activation: typeof activation;
  adminReset: typeof adminReset;
  auth: typeof auth;
  billing: typeof billing;
  crons: typeof crons;
  devices: typeof devices;
  email: typeof email;
  errors: typeof errors;
  feedback: typeof feedback;
  http: typeof http;
  invites: typeof invites;
  licenses: typeof licenses;
  licensing: typeof licensing;
  licensingShared: typeof licensingShared;
  migrations: typeof migrations;
  notify: typeof notify;
  rateLimiter: typeof rateLimiter;
  settings: typeof settings;
  settingsShared: typeof settingsShared;
  triggers: typeof triggers;
  utils: typeof utils;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
