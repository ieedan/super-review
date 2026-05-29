#!/usr/bin/env node
import { simpleGit } from "simple-git";
import path from "node:path";
import { captureSession, type SessionMeta } from "../main/session-capture.js";
import {
  findSessionByKey,
  getSession,
  writeSession,
} from "../main/session-store.js";
import { repoIdFromPath } from "../main/git-service.js";
import type { HarnessKind } from "@shared/types.js";

const HARNESSES: HarnessKind[] = [
  "claude-code",
  "cursor",
  "codex",
  "opencode",
  "copilot",
  "other",
];

const USAGE = `super-review — document an agent session for review

Usage:
  super-review session save [options]

Options:
  --key <id>           Stable upsert key (your harness conversation/run id).
                       Re-running with the same key UPDATES that session.
  --id <id>            Target an existing session by its id (alternative to --key).
  --name <text>        Session name (required on first save).
  --description <text> What you changed (required on first save).
  --harness <kind>     One of: ${HARNESSES.join(", ")} (default: other).
  --harness-label <t>  Freeform harness name (used when --harness other).
  --harness-url <url>  Deep link back to this run (resume/permalink).
  --cwd <path>         Repo path (default: current directory).
  -h, --help           Show this help.

Captures a frozen snapshot of the working tree's current changes so they can be
reviewed as an isolated session in the super-review desktop app.`;

// Minimal --flag value parser. Unknown flags are reported rather than ignored.
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      out.help = "true";
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    out[name] = value;
    i++;
  }
  return out;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function repoRoot(cwd: string): Promise<string> {
  try {
    const top = await simpleGit(cwd).revparse(["--show-toplevel"]);
    return top.trim();
  } catch {
    fail(`not a git repository: ${cwd}`);
  }
}

async function run(): Promise<void> {
  const [command, sub, ...rest] = process.argv.slice(2);

  if (command === "session" && sub === "save") {
    const args = parseArgs(rest);
    if (args.help) {
      console.log(USAGE);
      return;
    }

    const harness = (args.harness ?? "other") as HarnessKind;
    if (!HARNESSES.includes(harness)) {
      fail(
        `invalid --harness "${harness}". Expected one of: ${HARNESSES.join(", ")}`,
      );
    }

    const cwd = path.resolve(args.cwd ?? process.cwd());
    const root = await repoRoot(cwd);
    const repoId = repoIdFromPath(root);

    // Locate any existing session to update: explicit --id wins, else --key.
    let existing = null;
    if (args.id) {
      existing = await getSession(repoId, args.id);
      if (!existing) fail(`no session with id "${args.id}" for this repo`);
    } else if (args.key) {
      existing = await findSessionByKey(repoId, args.key);
    }

    if (!existing && (!args.name || !args.description)) {
      fail("--name and --description are required when creating a new session");
    }

    const meta: SessionMeta = {
      key: args.key,
      name: args.name,
      description: args.description,
      harness: args.harness ? harness : undefined,
      harnessLabel: args["harness-label"],
      harnessUrl: args["harness-url"],
    };

    const session = await captureSession(root, meta, existing);
    if (session.fileCount === 0) {
      fail("no working-tree changes to capture");
    }
    await writeSession(session);

    const verb = existing ? "updated" : "created";
    console.log(
      `${verb} session "${session.name}" (${session.id})\n` +
        `  ${session.fileCount} file(s), +${session.additions} −${session.deletions}`,
    );
    return;
  }

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  fail(
    `unknown command: ${[command, sub].filter(Boolean).join(" ")}\n\n${USAGE}`,
  );
}

run().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
