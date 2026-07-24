/**
 * Convex data migrations, run through the `@convex-dev/migrations` component.
 *
 * The component tracks each migration's cursor and completion in its own tables,
 * batches the work across transactions, and is safe to re-run and resume. Define
 * a migration with `migrations.define`, then run it from the CLI or dashboard:
 *
 *   convex run migrations:clearUpstashMarkers '{"dryRun":true}'
 *   convex run migrations:run '{"fn":"migrations:clearUpstashMarkers"}'
 */
import { Migrations } from '@convex-dev/migrations';
import { components } from './_generated/api';
import { internalMutation } from './_generated/server';
import type { DataModel } from './_generated/dataModel';

export const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** Generic runner: `convex run migrations:run '{"fn":"migrations:<name>"}'`. */
export const run = migrations.runner();

/**
 * Strips the retired Upstash import markers off `waitlistSignups`.
 *
 * The old marketing site's list was carried across by the now-deleted
 * `waitlistImport`, which tagged each migrated row with `importedFrom: 'upstash'`
 * and tracked the confirmation mail-out in `confirmationSentAt`. Nothing reads
 * those fields anymore. This clears them so the two columns can be dropped from
 * the schema in a follow-up, without deleting anyone from the waitlist.
 *
 * Rows that are already clean are skipped (the early return means no write), so
 * the migration is cheap to re-run.
 */
export const clearUpstashMarkers = migrations.define({
	table: 'waitlistSignups',
	migrateOne: (_ctx, doc) => {
		if (doc.importedFrom === undefined && doc.confirmationSentAt === undefined) return;
		// Patching a field to `undefined` deletes it from the document.
		return { importedFrom: undefined, confirmationSentAt: undefined };
	}
});
