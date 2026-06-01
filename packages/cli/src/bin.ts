#!/usr/bin/env node
import { cli } from './cli';
import { fail } from './util';

cli.parseAsync(process.argv).catch((err) => {
	fail(err instanceof Error ? err.message : String(err));
});
