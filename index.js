import { app, ipcMain, BrowserWindow, safeStorage, shell, powerMonitor, dialog, Menu, nativeImage, session } from "electron";
import path from "node:path";
import fs, { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, promises, watch, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fixPath from "fix-path";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { simpleGit } from "simple-git";
import crypto, { createHash, randomUUID, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import os, { homedir, tmpdir } from "node:os";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq, desc } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { Octokit } from "@octokit/rest";
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import Store from "electron-store";
import { z } from "zod";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import WebSocket from "ws";
import readline from "node:readline";
import electronUpdater from "electron-updater";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const isDev$1 = !app.isPackaged;
const sharedDir = app.getPath("userData");
const devDir = path.join(path.dirname(sharedDir), `${path.basename(sharedDir)}-dev`);
app.setName(isDev$1 ? "Super Review Dev" : "Super Review");
if (isDev$1) seedDevDir(sharedDir, devDir);
app.setPath("userData", isDev$1 ? devDir : sharedDir);
function seedDevDir(from, to) {
  const config = path.join(to, "super-review.json");
  const settings = path.join(to, "settings.json");
  if (existsSync(config)) return;
  try {
    mkdirSync(to, { recursive: true });
    const sourceConfig = path.join(from, "super-review.json");
    if (existsSync(sourceConfig)) {
      const parsed = JSON.parse(readFileSync(sourceConfig, "utf8"));
      delete parsed["license"];
      writeFileSync(config, JSON.stringify(parsed, null, "	"));
    }
    const sourceSettings = path.join(from, "settings.json");
    if (existsSync(sourceSettings) && !existsSync(settings)) copyFileSync(sourceSettings, settings);
  } catch {
  }
}
const COMMIT_MESSAGE_HARNESS_PRIORITY = [
  "cursor",
  "claude-code",
  "codex",
  "copilot",
  "opencode"
];
const HARNESS_LABELS = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
  other: "Agent"
};
function harnessLabel(harness, fallback) {
  if (harness === "other") return fallback?.trim() || HARNESS_LABELS.other;
  return HARNESS_LABELS[harness];
}
const HARNESS_LOGIN = {
  "claude-code": { command: "claude", then: "/login" },
  cursor: { command: "cursor-agent login" },
  codex: { command: "codex login" },
  copilot: { command: "copilot", then: "/login" },
  opencode: { command: "opencode auth login" }
};
function harnessLoginHint(harness) {
  const recipe = HARNESS_LOGIN[harness];
  return recipe.then ? `run \`${recipe.command}\`, then \`${recipe.then}\`` : `run \`${recipe.command}\``;
}
const LOCAL_COMMITS_LIMIT = 50;
const WINDOW_BOUNDS = {
  defaultWidth: 1250,
  defaultHeight: 825,
  minWidth: 720,
  minHeight: 480
};
const DEFAULT_HEADER_ITEMS = {
  changesToggle: true,
  commentsToggle: true,
  changeset: true,
  editor: true,
  terminal: true
};
const DEFAULT_EMPTY_VIEW_ITEMS = {
  editor: true,
  reveal: true,
  github: true,
  stats: true
};
const DEFAULT_SIDEBAR_TABS = {
  sessions: true,
  history: true,
  reviewProgress: true,
  lineCounts: true,
  collapseToggle: true
};
const DEFAULT_SIDEBAR_CONTROLS = {
  collapseSeen: true,
  viewToggle: true
};
const DEFAULT_FILE_HEADER_ITEMS = {
  editor: true,
  changedLines: true,
  viewToggle: true,
  markSeen: true
};
const IMAGE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml"
};
function extensionOf(filePath) {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "";
  return filePath.slice(dot + 1).toLowerCase();
}
function imageMimeForPath(filePath) {
  return IMAGE_MIME[extensionOf(filePath)] ?? null;
}
const GITIGNORE_TEMPLATES = {
  Node: `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Dependency directories
node_modules/
jspm_packages/

# Build output
dist/
build/
out/
.next/
.nuxt/
.svelte-kit/
.turbo/

# Caches
.npm
.eslintcache
.cache/
*.tsbuildinfo

# Environment
.env
.env.*
!.env.example

# Coverage
coverage/
.nyc_output/

# Editor / OS
.DS_Store
`,
  Python: `# Byte-compiled / optimized / DLL files
__pycache__/
*.py[cod]
*$py.class

# Distribution / packaging
build/
dist/
*.egg-info/
.eggs/
wheels/

# Virtual environments
.venv/
venv/
env/
ENV/

# Testing / coverage
.pytest_cache/
.tox/
.coverage
.coverage.*
htmlcov/
.mypy_cache/
.ruff_cache/

# Jupyter
.ipynb_checkpoints/

# Environment
.env

# Editor / OS
.DS_Store
`,
  Rust: `# Compiled output
/target/

# Backup files generated by rustfmt
**/*.rs.bk

# MSVC debug info
*.pdb

# Editor / OS
.DS_Store
`,
  Go: `# Binaries for programs and plugins
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test binary and coverage
*.test
*.out
coverage.txt

# Dependency directories
vendor/

# Go workspace file
go.work
go.work.sum

# Environment
.env

# Editor / OS
.DS_Store
`,
  Java: `# Compiled class files
*.class

# Log files
*.log

# Package files
*.jar
*.war
*.ear

# Build tools
target/
build/
.gradle/

# Virtual machine crash logs
hs_err_pid*

# Editor / OS
.idea/
*.iml
.DS_Store
`,
  "C++": `# Prerequisites
*.d

# Object files
*.o
*.obj
*.lo
*.slo

# Libraries
*.a
*.la
*.lib

# Shared objects
*.so
*.dylib
*.dll

# Executables
*.exe
*.out
*.app

# Build directories
build/
cmake-build-*/

# Editor / OS
.DS_Store
`,
  Unity: `# Unity generated
[Ll]ibrary/
[Tt]emp/
[Oo]bj/
[Bb]uild/
[Bb]uilds/
[Ll]ogs/
[Uu]ser[Ss]ettings/

# Asset meta data
!/[Aa]ssets/**/*.meta

# Visual Studio / Rider
.vs/
.idea/
*.csproj
*.sln

# Editor / OS
.DS_Store
`,
  "Visual Studio": `# User-specific files
*.suo
*.user
*.userosscache
*.sln.docstates

# Build results
[Dd]ebug/
[Rr]elease/
x64/
x86/
[Bb]in/
[Oo]bj/

# Visual Studio cache/options
.vs/

# NuGet
*.nupkg
packages/

# Editor / OS
.DS_Store
`
};
const LICENSE_TEMPLATES = {
  MIT: `MIT License

Copyright (c) {year} {author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  "BSD 2-Clause": `BSD 2-Clause License

Copyright (c) {year}, {author}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`,
  "BSD 3-Clause": `BSD 3-Clause License

Copyright (c) {year}, {author}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`,
  ISC: `ISC License

Copyright (c) {year} {author}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`,
  "The Unlicense": `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
`,
  "Apache License 2.0": `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or Derivative
          Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {year} {author}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
`
};
function listTemplates() {
  return {
    gitignores: Object.keys(GITIGNORE_TEMPLATES),
    licenses: Object.keys(LICENSE_TEMPLATES)
  };
}
function getGitignore(label) {
  return GITIGNORE_TEMPLATES[label] ?? null;
}
function getLicense(label, vars) {
  const template = LICENSE_TEMPLATES[label];
  if (!template) return null;
  return template.replaceAll("{year}", String(vars.year)).replaceAll("{author}", vars.author);
}
const execFileAsync$4 = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RENDER_LINE_BYTES = 100 * 1024;
function tooLargeToRender(oldContents, newContents) {
  return oldContents.length > MAX_FILE_BYTES || newContents.length > MAX_FILE_BYTES || hasOverlongLine(oldContents) || hasOverlongLine(newContents);
}
function hasOverlongLine(contents) {
  let start = 0;
  for (; ; ) {
    const nl = contents.indexOf("\n", start);
    if (nl === -1) return contents.length - start > MAX_RENDER_LINE_BYTES;
    if (nl - start > MAX_RENDER_LINE_BYTES) return true;
    start = nl + 1;
  }
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
let credentialProvider = null;
function setGitCredentialProvider(provider) {
  credentialProvider = provider;
}
function authConfig(remoteUrl, repoPath) {
  if (!remoteUrl || !credentialProvider) return [];
  let origin;
  try {
    const u = new URL(remoteUrl);
    if (u.protocol !== "https:") return [];
    origin = u.origin;
  } catch {
    return [];
  }
  const creds = credentialProvider(remoteUrl, repoPath);
  if (!creds) return [];
  const basic = Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
  return [`http.${origin}/.extraHeader=Authorization: Basic ${basic}`];
}
function openGit(repoPath, options) {
  const git = repoPath ? simpleGit(repoPath, options) : options ? simpleGit(options) : simpleGit();
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  stripEditorEnv(env);
  return git.env(env);
}
function stripEditorEnv(env) {
  delete env.GIT_EDITOR;
  delete env.GIT_SEQUENCE_EDITOR;
  delete env.EDITOR;
  delete env.VISUAL;
}
function authedGit(repoPath, remoteUrl) {
  const config = authConfig(remoteUrl, repoPath);
  const options = config.length ? { config } : void 0;
  return openGit(repoPath, options);
}
const writeChains = /* @__PURE__ */ new Map();
const heldWriteLocks = new AsyncLocalStorage();
const INDEX_LOCK_STALE_MS = 1e4;
async function withRepoWriteLock(repoPath, fn) {
  const key = path.resolve(repoPath);
  const held = heldWriteLocks.getStore();
  if (held?.has(key)) return fn();
  const prev = writeChains.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((r) => release = r);
  writeChains.set(
    key,
    prev.then(
      () => gate,
      () => gate
    )
  );
  await prev.catch(() => {
  });
  const nextHeld = new Set(held);
  nextHeld.add(key);
  try {
    return await heldWriteLocks.run(nextHeld, () => runWriteWithLockRecovery(key, fn));
  } finally {
    release();
  }
}
function isIndexLockCollision(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("index.lock") && /file exists|already exists|unable to create/i.test(msg);
}
async function runWriteWithLockRecovery(repoPath, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isIndexLockCollision(err)) throw err;
    const cleared = await removeStaleIndexLock(repoPath);
    if (!cleared) throw err;
    return await fn();
  }
}
async function removeStaleIndexLock(repoPath) {
  try {
    const gitDir = (await openGit(repoPath).raw(["rev-parse", "--absolute-git-dir"])).trim();
    const lockPath = path.join(gitDir, "index.lock");
    const stat = await promises.stat(lockPath).catch(() => null);
    if (!stat) return false;
    if (Date.now() - stat.mtimeMs < INDEX_LOCK_STALE_MS) return false;
    await promises.rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}
function lockWrite(fn) {
  return (repoPath, ...args) => withRepoWriteLock(repoPath, () => fn(repoPath, ...args));
}
const checkout = lockWrite(checkoutImpl);
const createBranch = lockWrite(createBranchImpl);
const deleteBranch = lockWrite(deleteBranchImpl);
const pull = lockWrite(pullImpl);
const mergeIntoCurrent = lockWrite(mergeIntoCurrentImpl);
const updateFromUpstream = lockWrite(updateFromUpstreamImpl);
const push = lockWrite(pushImpl);
const stageFile = lockWrite(stageFileImpl);
const discardChanges = lockWrite(discardChangesImpl);
const discardFiles = lockWrite(discardFilesImpl);
const discardLines = lockWrite(discardLinesImpl);
const addToGitignore = lockWrite(addToGitignoreImpl);
const continueMerge = lockWrite(continueMergeImpl);
const abortMerge = lockWrite(abortMergeImpl);
const createManagedStash = lockWrite(createManagedStashImpl);
const restoreManagedStash = lockWrite(restoreManagedStashImpl);
const restoreManagedStashKeepingLocal = lockWrite(restoreManagedStashKeepingLocalImpl);
const discardManagedStash = lockWrite(discardManagedStashImpl);
const finishStashPop = lockWrite(finishStashPopImpl);
const abortStashPop = lockWrite(abortStashPopImpl);
const commit = lockWrite(commitImpl);
const undoLastCommit = lockWrite(undoLastCommitImpl);
const checkoutPR = lockWrite(checkoutPRImpl);
const pinPRBaseRef = lockWrite(pinPRBaseRefImpl);
async function originRemoteUrl(git) {
  const remotes = await git.getRemotes(true).catch(() => []);
  const origin = remotes.find((r) => r.name === "origin");
  return origin?.refs.push ?? origin?.refs.fetch ?? null;
}
async function resolveRemoteUrl(git, remote) {
  const remotes = await git.getRemotes(true).catch(() => []);
  const named = remotes.find((r) => r.name === remote);
  if (named) return named.refs.push ?? named.refs.fetch ?? null;
  return remote;
}
function repoIdFromPath(p) {
  return createHash("sha1").update(path.resolve(p)).digest("hex").slice(0, 12);
}
async function isGitRepo(dirPath) {
  try {
    const git = openGit(dirPath);
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}
const SCAN_IGNORE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  "Pods"
]);
const MAX_SCAN_DEPTH = 4;
async function scanForRepos(rootPath) {
  const found = [];
  async function walk(dir, depth) {
    let isRepo = false;
    try {
      await promises.stat(path.join(dir, ".git"));
      isRepo = true;
    } catch {
    }
    if (isRepo) {
      found.push(dir);
      return;
    }
    if (depth >= MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = await promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith(".") && !SCAN_IGNORE_DIRS.has(e.name)
    );
    await Promise.all(subdirs.map((e) => walk(path.join(dir, e.name), depth + 1)));
  }
  await walk(path.resolve(rootPath), 0);
  return found;
}
const ICON_RANK_FAVICON = 0;
const ICON_RANK_APPLE_TOUCH = 1;
const ICON_RANK_PWA = 2;
const ICON_RANK_FAVICON_VARIANT = 3;
const ICON_RANK_LOGO = 4;
function iconBaseRank(stem) {
  if (stem === "favicon") return ICON_RANK_FAVICON;
  if (stem === "apple-touch-icon" || stem.startsWith("apple-touch-icon-"))
    return ICON_RANK_APPLE_TOUCH;
  if (stem.startsWith("android-chrome") || stem === "icon" || stem.startsWith("icon-") || stem === "app-icon" || stem === "appicon" || stem.startsWith("maskable"))
    return ICON_RANK_PWA;
  if (stem.startsWith("favicon-") || stem.startsWith("favicon_")) return ICON_RANK_FAVICON_VARIANT;
  if (stem === "logo" || stem.startsWith("logo-") || stem.startsWith("logo_") || stem.endsWith("-logo") || stem.endsWith("_logo"))
    return ICON_RANK_LOGO;
  return void 0;
}
const ICON_EXT_PRIORITY = {
  svg: 0,
  png: 1,
  ico: 2
};
const GENERIC_ICON_HASHES = /* @__PURE__ */ new Set([
  // SvelteKit skeleton `favicon.png` — the grey Svelte logo, 128×128, 1571 bytes.
  "3a387408ecc6cc283f724b39ca5fffb4",
  // SvelteKit skeleton `favicon.svg` — the orange (#ff3e00) Svelte logo, 1569 bytes.
  "a0d1b540c1b9a2a920d5f6cae983118a"
]);
const SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  ".angular",
  "dist",
  "out",
  "build",
  "target",
  "coverage",
  "tmp",
  "temp",
  ".idea",
  ".vscode"
]);
const NON_CANONICAL_SEGMENTS = /* @__PURE__ */ new Set([
  "examples",
  "example",
  "demo",
  "demos",
  "sample",
  "samples",
  "fixture",
  "fixtures",
  "test",
  "tests",
  "__tests__",
  "e2e",
  "playground",
  "sandbox",
  "storybook",
  ".storybook",
  // Scaffolding the repo *ships* (starter templates, boilerplates). Their
  // favicons are stock placeholders, not the project's own brand — so a repo's
  // real icon in `apps/web/` should outrank a `favicon.svg` in `templates/`.
  "template",
  "templates",
  "starter",
  "starters",
  "boilerplate",
  "scaffold"
]);
const ELECTRON_CONFIG_FILES = /* @__PURE__ */ new Set([
  "electron-builder.yml",
  "electron-builder.yaml",
  "electron-builder.json",
  "electron-builder.json5",
  "electron-builder.js",
  "electron-builder.cjs",
  "electron-builder.mjs",
  "electron-builder.ts"
]);
async function electronIconIn(dir, entries) {
  let isElectron = entries.some(
    (e) => e.isFile() && ELECTRON_CONFIG_FILES.has(e.name.toLowerCase())
  );
  let buildResources = "build";
  if (entries.some((e) => e.isFile() && e.name === "package.json")) {
    try {
      const pkg = JSON.parse(await promises.readFile(path.join(dir, "package.json"), "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.electron || deps["electron-builder"] || pkg.build) {
        isElectron = true;
      }
      const br = pkg.build?.directories?.buildResources;
      if (typeof br === "string" && br) buildResources = br;
    } catch {
    }
  }
  if (!isElectron) return void 0;
  for (const rel of [
    `${buildResources}/icon.png`,
    `${buildResources}/icon.ico`,
    `${buildResources}/icons/512x512.png`
  ]) {
    const candidate = path.join(dir, rel);
    try {
      const st = await promises.stat(candidate);
      if (st.isFile() && st.size > 0 && st.size <= 256 * 1024) return candidate;
    } catch {
    }
  }
  return void 0;
}
function iconBufferToDataUrl(buf, filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "ico" ? "image/x-icon" : `image/${ext}`;
  return `data:${mime};base64,${buf.toString("base64")}`;
}
function parseThemeSuffix(stem) {
  const m = stem.match(/^(.+)([-_])(dark|light)$/);
  if (!m) return void 0;
  return { base: m[1], sep: m[2], theme: m[3] };
}
async function resolveIconPair(winnerPath, winnerBuf) {
  const winnerUrl = iconBufferToDataUrl(winnerBuf, winnerPath);
  const winnerExt = path.extname(winnerPath).slice(1).toLowerCase();
  const stem = winnerPath.slice(0, winnerPath.length - winnerExt.length - 1).split(path.sep).pop().toLowerCase();
  const parsed = parseThemeSuffix(stem);
  if (!parsed) return { iconDataUrl: winnerUrl };
  const opposite = parsed.theme === "dark" ? "light" : "dark";
  const wantStem = `${parsed.base}${parsed.sep}${opposite}`;
  const dir = path.dirname(winnerPath);
  let entries;
  try {
    entries = await promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { iconDataUrl: winnerUrl };
  }
  const siblings = entries.filter((e) => e.isFile()).map((e) => {
    const ext = path.extname(e.name).slice(1).toLowerCase();
    return {
      name: e.name,
      ext,
      stem: e.name.slice(0, e.name.length - ext.length - 1).toLowerCase()
    };
  }).filter((c) => ICON_EXT_PRIORITY[c.ext] !== void 0 && c.stem === wantStem).sort(
    (a, b) => (a.ext === winnerExt ? 0 : 1) - (b.ext === winnerExt ? 0 : 1) || ICON_EXT_PRIORITY[a.ext] - ICON_EXT_PRIORITY[b.ext]
  );
  if (siblings.length === 0) return { iconDataUrl: winnerUrl };
  const sibPath = path.join(dir, siblings[0].name);
  let sibBuf;
  try {
    sibBuf = await promises.readFile(sibPath);
  } catch {
    return { iconDataUrl: winnerUrl };
  }
  if (sibBuf.byteLength === 0 || sibBuf.byteLength > 256 * 1024) return { iconDataUrl: winnerUrl };
  const sibUrl = iconBufferToDataUrl(sibBuf, sibPath);
  return parsed.theme === "dark" ? { iconDataUrl: sibUrl, iconDataUrlDark: winnerUrl } : { iconDataUrl: winnerUrl, iconDataUrlDark: sibUrl };
}
async function findRepoIcon(repoPath) {
  const MAX_DEPTH = 5;
  const candidates = [];
  async function visit(dir, depth, nonCanonical) {
    let entries;
    try {
      entries = await promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const elIcon = await electronIconIn(dir, entries);
    if (elIcon) {
      const ext = path.extname(elIcon).slice(1).toLowerCase();
      const score = (ICON_EXT_PRIORITY[ext] ?? 1) * 10 + depth + (nonCanonical ? 500 : 0);
      candidates.push({ path: elIcon, score, baseRank: 0 });
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".well-known") {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
        if (entry.isDirectory()) continue;
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (depth >= MAX_DEPTH) continue;
        const childNonCanonical = nonCanonical || NON_CANONICAL_SEGMENTS.has(entry.name.toLowerCase());
        await visit(path.join(dir, entry.name), depth + 1, childNonCanonical);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        const extPriority = ICON_EXT_PRIORITY[ext];
        if (extPriority === void 0) continue;
        const stem = entry.name.slice(0, entry.name.length - ext.length - 1).toLowerCase();
        const basePriority = iconBaseRank(stem);
        if (basePriority === void 0) continue;
        const score = basePriority * 100 + extPriority * 10 + depth + (nonCanonical ? 500 : 0);
        const parsed = parseThemeSuffix(stem);
        const pairKey = parsed ? `${dir}\0${parsed.base}${parsed.sep}` : void 0;
        candidates.push({
          path: path.join(dir, entry.name),
          score,
          baseRank: basePriority,
          pairKey,
          theme: parsed?.theme
        });
      }
    }
  }
  await visit(repoPath, 0, false);
  if (candidates.length === 0) return void 0;
  const themesByKey = /* @__PURE__ */ new Map();
  for (const c of candidates) {
    if (!c.pairKey || !c.theme) continue;
    const set = themesByKey.get(c.pairKey) ?? /* @__PURE__ */ new Set();
    set.add(c.theme);
    themesByKey.set(c.pairKey, set);
  }
  const isThemedFaviconPair = (c) => c.baseRank === ICON_RANK_FAVICON_VARIANT && c.pairKey !== void 0 && themesByKey.get(c.pairKey)?.size === 2;
  const effectiveScore = (c) => isThemedFaviconPair(c) ? c.score - ICON_RANK_FAVICON_VARIANT * 100 : c.score;
  candidates.sort((a, b) => effectiveScore(a) - effectiveScore(b));
  let fallback;
  for (const { path: candidatePath } of candidates) {
    let buf;
    try {
      buf = await promises.readFile(candidatePath);
    } catch {
      continue;
    }
    if (buf.byteLength === 0 || buf.byteLength > 256 * 1024) continue;
    const hash2 = createHash("md5").update(buf).digest("hex");
    if (GENERIC_ICON_HASHES.has(hash2)) {
      fallback ??= iconBufferToDataUrl(buf, candidatePath);
      continue;
    }
    return resolveIconPair(candidatePath, buf);
  }
  return fallback ? { iconDataUrl: fallback } : void 0;
}
let sshHostMapCache = null;
async function sshHostMap() {
  if (sshHostMapCache) return sshHostMapCache;
  const map = /* @__PURE__ */ new Map();
  try {
    const cfg = await promises.readFile(path.join(os.homedir(), ".ssh", "config"), "utf8");
    let aliases = [];
    for (const raw of cfg.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const sep = line.search(/\s|=/);
      if (sep === -1) continue;
      const key = line.slice(0, sep).toLowerCase();
      const value = line.slice(sep + 1).replace(/^[=\s]+/, "").trim();
      if (key === "host") aliases = value.split(/\s+/);
      else if (key === "hostname") for (const a of aliases) map.set(a, value);
    }
  } catch {
  }
  sshHostMapCache = map;
  return map;
}
async function parseGithubFromUrl(url) {
  let host;
  let rest;
  if (!url.includes("://")) {
    const m2 = url.match(/^[^@]+@([^:/]+):(.+)$/);
    if (m2) {
      host = m2[1];
      rest = m2[2];
    }
  }
  if (!host) {
    const m2 = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/i);
    if (m2) {
      host = m2[1];
      rest = m2[2];
    }
  }
  if (!host || !rest) return void 0;
  let realHost = host;
  if (realHost.toLowerCase() !== "github.com") {
    realHost = (await sshHostMap()).get(host) ?? host;
  }
  if (realHost.toLowerCase() !== "github.com") return void 0;
  const m = rest.replace(/\.git$/i, "").replace(/\/+$/, "").match(/^([^/]+)\/([^/]+)$/);
  if (!m) return void 0;
  return { owner: m[1], repo: m[2] };
}
async function buildRepoInfo(repoPath) {
  const git = openGit(repoPath);
  const id = repoIdFromPath(repoPath);
  const name = path.basename(repoPath);
  let remoteUrl;
  let githubOwner;
  let githubRepo;
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
    if (origin?.refs.fetch) {
      remoteUrl = origin.refs.fetch;
      const gh = await parseGithubFromUrl(remoteUrl);
      if (gh) {
        githubOwner = gh.owner;
        githubRepo = gh.repo;
      }
      console.log(
        `[repo] buildRepoInfo "${name}" remote=${origin.name} url=${remoteUrl} → parsed ${gh ? `${gh.owner}/${gh.repo}` : "(not a github.com URL)"}`
      );
    } else {
      console.log(
        `[repo] buildRepoInfo "${name}" has no usable remote (remotes: ${remotes.map((r) => r.name).join(", ") || "none"})`
      );
    }
  } catch (err) {
    console.error(`[repo] buildRepoInfo "${name}" failed to read remotes:`, err);
  }
  const defaultBranch = await detectDefaultBranch(git);
  const icon = await findRepoIcon(repoPath);
  const description = await readRepoDescription(repoPath);
  return {
    id,
    path: path.resolve(repoPath),
    name,
    iconDataUrl: icon?.iconDataUrl,
    iconDataUrlDark: icon?.iconDataUrlDark,
    remoteUrl,
    githubOwner,
    githubRepo,
    defaultBranch,
    description,
    lastOpenedAt: Date.now()
  };
}
async function readRepoDescription(repoPath) {
  try {
    const raw = (await promises.readFile(path.join(repoPath, ".git", "description"), "utf8")).trim();
    if (!raw || raw.startsWith("Unnamed repository")) return void 0;
    return raw;
  } catch {
    return void 0;
  }
}
async function listBranches(repoPath) {
  const git = openGit(repoPath);
  const [currentRaw, raw] = await Promise.all([
    git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
    git.raw([
      "for-each-ref",
      "--format=%(refname)	%(committerdate:unix)	%(upstream:short)	%(symref)",
      "refs/heads",
      "refs/remotes"
    ])
  ]);
  const current2 = currentRaw.trim();
  const branches = [];
  const localNames = /* @__PURE__ */ new Set();
  const remoteOnly = /* @__PURE__ */ new Map();
  for (const line of raw.split("\n").filter(Boolean)) {
    const [refname, tsRaw, upstreamRaw, symref] = line.split("	");
    if (!refname) continue;
    const ts = Number(tsRaw);
    const lastCommitAt = Number.isFinite(ts) && ts > 0 ? ts * 1e3 : void 0;
    if (refname.startsWith("refs/heads/")) {
      const name = refname.slice("refs/heads/".length);
      if (!name) continue;
      localNames.add(name);
      branches.push({
        name,
        current: name === current2,
        // `%(upstream:short)` is the configured tracking branch (e.g.
        // "origin/feat") — its presence is how we tell a local branch also
        // lives on a remote. Empty when the branch tracks nothing.
        upstream: upstreamRaw ? upstreamRaw : void 0,
        isRemote: false,
        lastCommitAt
      });
    } else if (refname.startsWith("refs/remotes/")) {
      if (symref) continue;
      const qualified = refname.slice("refs/remotes/".length);
      const slash = qualified.indexOf("/");
      if (slash < 0) continue;
      const remote = qualified.slice(0, slash);
      const name = qualified.slice(slash + 1);
      if (!name || name === "HEAD") continue;
      const existing = remoteOnly.get(name);
      if (!existing || existing.remote !== "origin" && remote === "origin") {
        remoteOnly.set(name, { upstream: qualified, remote, lastCommitAt });
      }
    }
  }
  for (const [name, r] of remoteOnly) {
    if (localNames.has(name)) continue;
    branches.push({
      name,
      current: false,
      upstream: r.upstream,
      isRemote: true,
      lastCommitAt: r.lastCommitAt
    });
  }
  branches.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
    const at = a.lastCommitAt ?? 0;
    const bt = b.lastCommitAt ?? 0;
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });
  return branches;
}
async function listLocalOnlyBranches(repoPath) {
  const git = openGit(repoPath);
  const [currentRaw, raw, stashRaw] = await Promise.all([
    git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
    git.raw([
      "for-each-ref",
      "--format=%(refname:short)	%(committerdate:unix)	%(upstream:short)	%(upstream:track)",
      "refs/heads"
    ]),
    git.raw(["stash", "list", "--format=%gs"]).catch(() => "")
  ]);
  const current2 = currentRaw.trim();
  const stashCounts = /* @__PURE__ */ new Map();
  for (const line of stashRaw.split("\n")) {
    const m = /^(?:WIP on|On) (.+?):/.exec(line.trim());
    if (!m) continue;
    stashCounts.set(m[1], (stashCounts.get(m[1]) ?? 0) + 1);
  }
  const branches = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const [name, tsRaw, upstream, track] = line.split("	");
    if (!name || name === current2) continue;
    const gone = (track ?? "").includes("gone");
    if (upstream && !gone) continue;
    const ts = Number(tsRaw);
    branches.push({
      name,
      lastCommitAt: Number.isFinite(ts) && ts > 0 ? ts * 1e3 : void 0,
      goneUpstream: gone ? upstream : void 0,
      stashCount: stashCounts.get(name) ?? 0
    });
  }
  branches.sort((a, b) => {
    const at = a.lastCommitAt ?? 0;
    const bt = b.lastCommitAt ?? 0;
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });
  return branches;
}
async function getCurrentBranch(repoPath) {
  const git = openGit(repoPath);
  try {
    const status = await git.status();
    return status.current ?? null;
  } catch {
    return null;
  }
}
async function checkoutImpl(repoPath, branch) {
  const git = openGit(repoPath);
  await git.checkout(branch);
}
async function isWorkingTreeDirty(repoPath) {
  try {
    const status = await openGit(repoPath).status();
    return !status.isClean();
  } catch {
    return false;
  }
}
async function createBranchImpl(repoPath, name, opts) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Branch name is required." };
  const git = openGit(repoPath);
  try {
    if (opts.checkout) {
      const args = ["checkout", "-b", trimmed];
      if (opts.base) args.push(opts.base);
      await git.raw(args);
    } else {
      const args = ["branch", trimmed];
      if (opts.base) args.push(opts.base);
      await git.raw(args);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function deleteBranchImpl(repoPath, name, opts) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Branch name is required." };
  const git = openGit(repoPath);
  try {
    await git.raw(["branch", "-D", trimmed]);
    if (opts.deleteRemote && opts.upstream) {
      const slash = opts.upstream.indexOf("/");
      if (slash > 0) {
        const remote = opts.upstream.slice(0, slash);
        const ref = opts.upstream.slice(slash + 1);
        const remoteUrl = await resolveRemoteUrl(git, remote);
        await authedGit(repoPath, remoteUrl).push([remote, "--delete", ref]);
      }
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function mapStatus(x, y) {
  const c = (x + y).trim();
  if (c.includes("?")) return "untracked";
  if (x === "R" || y === "R") return "renamed";
  if (x === "C" || y === "C") return "copied";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "T" || y === "T") return "type-change";
  return "modified";
}
async function refsForContext(git, ctx) {
  switch (ctx.kind) {
    case "workingTree":
      return { workingTree: true };
    case "branch":
      return { base: await preferRemoteBase(git, ctx.base), head: ctx.head, workingTree: false };
    case "pr":
      return {
        base: `pr/${ctx.prNumber}/base`,
        head: `pr/${ctx.prNumber}/head`,
        workingTree: false
      };
    case "commit": {
      const parent = `${ctx.ref}^`;
      const hasParent = await revExists$1(git, parent);
      return { base: hasParent ? parent : EMPTY_TREE, head: ctx.ref, workingTree: false };
    }
    case "session":
      throw new Error("session context is not backed by git");
    case "stash":
      throw new Error("stash context is handled by dedicated branches");
  }
}
async function revExists$1(git, ref) {
  try {
    const out = await git.raw(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}
async function resolveRef(repoPath, ref) {
  const git = openGit(repoPath);
  try {
    const out = await git.raw(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    const sha = out.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}
async function refExists(repoPath, ref) {
  return await resolveRef(repoPath, ref) !== null;
}
async function preferRemoteBase(git, base) {
  if (base.startsWith("origin/")) return base;
  const remote = `origin/${base}`;
  return await revExists$1(git, remote) ? remote : base;
}
async function listChangedFiles(repoPath, ctx) {
  const git = openGit(repoPath);
  if (ctx.kind === "stash") {
    const ref = ctx.ref;
    const stashFiles = [];
    if (!await revExists$1(git, ref)) return stashFiles;
    const nameStatus = await git.raw(["diff", "--name-status", "--find-renames", `${ref}^1`, ref]).catch(() => "");
    const numstatRaw = await git.raw(["diff", "--numstat", `${ref}^1`, ref]).catch(() => "");
    const numstatMap = parseNumstat(numstatRaw);
    const oidMap = parseRawOids(
      await git.raw(["diff", "--raw", "--no-abbrev", "--find-renames", `${ref}^1`, ref]).catch(() => "")
    );
    for (const line of nameStatus.split("\n").filter(Boolean)) {
      const parts = line.split("	");
      const code = parts[0];
      let status = "modified";
      let oldPath;
      let p = parts[1];
      if (code.startsWith("A")) status = "added";
      else if (code.startsWith("D")) status = "deleted";
      else if (code.startsWith("M")) status = "modified";
      else if (code.startsWith("R")) {
        status = "renamed";
        oldPath = parts[1];
        p = parts[2];
      } else if (code.startsWith("C")) {
        status = "copied";
        oldPath = parts[1];
        p = parts[2];
      } else if (code.startsWith("T")) status = "type-change";
      const ns = numstatMap.get(p) ?? { additions: 0, deletions: 0, binary: false };
      stashFiles.push({
        path: p,
        oldPath,
        status,
        additions: ns.additions,
        deletions: ns.deletions,
        isBinary: ns.binary,
        contentSig: oidMap.get(p)?.dst,
        baseContentSig: oidMap.get(p)?.base
      });
    }
    if (await revExists$1(git, `${ref}^3`)) {
      const untrackedNumstat = await git.raw(["diff", "--numstat", EMPTY_TREE, `${ref}^3`]).catch(() => "");
      const untrackedMap = parseNumstat(untrackedNumstat);
      const untrackedOids = parseRawOids(
        await git.raw(["diff", "--raw", "--no-abbrev", EMPTY_TREE, `${ref}^3`]).catch(() => "")
      );
      for (const [p, ns] of untrackedMap) {
        stashFiles.push({
          path: p,
          status: "added",
          additions: ns.additions,
          deletions: ns.deletions,
          isBinary: ns.binary,
          contentSig: untrackedOids.get(p)?.dst,
          baseContentSig: untrackedOids.get(p)?.base
        });
      }
    }
    return stashFiles;
  }
  const refs = await refsForContext(git, ctx);
  const files = [];
  if (refs.workingTree) {
    const [status, numstatRaw, patchRaw] = await Promise.all([
      git.status(),
      git.raw(["diff", "--numstat", "HEAD"]).catch(() => ""),
      git.raw(["diff", "--full-index", "--find-renames", "HEAD"]).catch(() => "")
    ]);
    const numstatMap = parseNumstat(numstatRaw);
    const oidMap = parsePatchOids(patchRaw);
    const untrackedReadTasks = [];
    for (const f of status.files) {
      const fullStatus = mapStatus(f.index, f.working_dir);
      let oldPath;
      let p = f.path;
      if (f.from) {
        oldPath = f.from;
      } else {
        const renameMatch = f.path.match(/^(.+) -> (.+)$/);
        if (renameMatch) {
          oldPath = renameMatch[1];
          p = renameMatch[2];
        }
      }
      const ns = numstatMap.get(p) ?? {
        additions: 0,
        deletions: 0,
        binary: false
      };
      files.push({
        path: p,
        oldPath,
        status: fullStatus,
        additions: ns.additions,
        deletions: ns.deletions,
        isBinary: ns.binary,
        contentSig: oidMap.get(p)?.dst,
        baseContentSig: oidMap.get(p)?.base
      });
      if (!ns.binary && ns.additions === 0 && ns.deletions === 0 && (fullStatus === "untracked" || fullStatus === "added")) {
        untrackedReadTasks.push({ index: files.length - 1, filePath: p });
      }
    }
    if (untrackedReadTasks.length > 0) {
      await Promise.all(
        untrackedReadTasks.map(async ({ index, filePath }) => {
          const counted = await countWorkingLines(repoPath, filePath);
          if (counted) {
            files[index] = {
              ...files[index],
              additions: counted.additions,
              isBinary: counted.binary,
              contentSig: counted.sig ?? files[index].contentSig
              // An untracked file has no old side, so baseContentSig stays
              // undefined and its diff identity rests on the content alone.
            };
          }
        })
      );
    }
    return files;
  }
  if (refs.base && refs.head) {
    const [baseExists, headExists2] = await Promise.all([
      revExists$1(git, refs.base),
      revExists$1(git, refs.head)
    ]);
    if (!baseExists || !headExists2) {
      return files;
    }
    const [raw, numstatRaw, rawOidsRaw] = await Promise.all([
      git.raw(["diff", "--name-status", "--find-renames", `${refs.base}...${refs.head}`]),
      git.raw(["diff", "--numstat", `${refs.base}...${refs.head}`]),
      git.raw(["diff", "--raw", "--no-abbrev", "--find-renames", `${refs.base}...${refs.head}`]).catch(() => "")
    ]);
    const numstatMap = parseNumstat(numstatRaw);
    const oidMap = parseRawOids(rawOidsRaw);
    for (const line of raw.split("\n").filter(Boolean)) {
      const parts = line.split("	");
      const code = parts[0];
      let status = "modified";
      let oldPath;
      let p = parts[1];
      if (code.startsWith("A")) status = "added";
      else if (code.startsWith("D")) status = "deleted";
      else if (code.startsWith("M")) status = "modified";
      else if (code.startsWith("R")) {
        status = "renamed";
        oldPath = parts[1];
        p = parts[2];
      } else if (code.startsWith("C")) {
        status = "copied";
        oldPath = parts[1];
        p = parts[2];
      } else if (code.startsWith("T")) status = "type-change";
      const ns = numstatMap.get(p) ?? {
        additions: 0,
        deletions: 0,
        binary: false
      };
      files.push({
        path: p,
        oldPath,
        status,
        additions: ns.additions,
        deletions: ns.deletions,
        isBinary: ns.binary,
        contentSig: oidMap.get(p)?.dst,
        baseContentSig: oidMap.get(p)?.base
      });
    }
  }
  return files;
}
function realOid(sha) {
  return sha && !/^0+$/.test(sha) ? sha : void 0;
}
function parseRawOids(raw) {
  const map = /* @__PURE__ */ new Map();
  for (const line of raw.split("\n").filter(Boolean)) {
    const tabIdx = line.indexOf("	");
    if (tabIdx === -1) continue;
    const meta = line.slice(0, tabIdx).split(" ");
    const dst = realOid(meta[3]);
    if (!dst) continue;
    const paths = line.slice(tabIdx + 1).split("	");
    const p = paths[paths.length - 1];
    map.set(p, { dst, base: realOid(meta[2]) });
  }
  return map;
}
function parsePatchOids(patch) {
  const map = /* @__PURE__ */ new Map();
  let currentPath;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const bIdx = line.indexOf(" b/");
      currentPath = bIdx === -1 ? void 0 : line.slice(bIdx + 3);
    } else if (currentPath && line.startsWith("index ")) {
      const m = line.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/);
      const dst = realOid(m?.[2]);
      if (dst) map.set(currentPath, { dst, base: realOid(m?.[1]) });
    }
  }
  return map;
}
function parseNumstat(raw) {
  const map = /* @__PURE__ */ new Map();
  for (const line of raw.split("\n").filter(Boolean)) {
    const [a, d, ...pathParts] = line.split("	");
    const p = pathParts.join("	");
    const binary = a === "-" && d === "-";
    map.set(p, {
      additions: binary ? 0 : Number(a) || 0,
      deletions: binary ? 0 : Number(d) || 0,
      binary
    });
  }
  return map;
}
async function safeNumstat(git, base, head, filePath) {
  try {
    const args = ["diff", "--numstat"];
    if (base && head) args.push(`${base}...${head}`);
    args.push("--", filePath);
    const raw = await git.raw(args);
    const row = parseNumstat(raw).get(filePath);
    return row ?? { additions: 0, deletions: 0, binary: false };
  } catch {
    return { additions: 0, deletions: 0, binary: false };
  }
}
async function countWorkingLines(repoPath, filePath) {
  try {
    const abs = path.join(repoPath, filePath);
    const stat = await promises.stat(abs);
    if (!stat.isFile()) return null;
    if (stat.size === 0) return { additions: 0, binary: false, sig: "empty" };
    if (stat.size > MAX_FILE_BYTES)
      return { additions: 0, binary: false, sig: `size:${stat.size}` };
    const buf = await promises.readFile(abs);
    const sig = createHash("sha1").update(buf).digest("hex");
    const probeEnd = Math.min(buf.length, 8192);
    for (let i = 0; i < probeEnd; i++) {
      if (buf[i] === 0) return { additions: 0, binary: true, sig };
    }
    let lines = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) lines++;
    }
    if (buf[buf.length - 1] !== 10) lines++;
    return { additions: lines, binary: false, sig };
  } catch {
    return null;
  }
}
async function isUntrackedFile(git, filePath) {
  const out = await git.raw(["ls-files", "-z", "--others", "--exclude-standard", "--", filePath]).catch(() => "");
  return out.split("\0").some((p) => p === filePath);
}
async function showFile(git, ref, filePath) {
  try {
    return await git.show([`${ref}:${filePath}`]);
  } catch {
    return "";
  }
}
async function readWorkingFile(repoPath, filePath) {
  try {
    const buf = await promises.readFile(path.join(repoPath, filePath));
    if (buf.byteLength > MAX_FILE_BYTES) return "";
    return buf.toString("utf8");
  } catch {
    return "";
  }
}
async function showFileBuffer(repoPath, ref, filePath) {
  try {
    const { stdout } = await execFileAsync$4("git", ["show", `${ref}:${filePath}`], {
      cwd: repoPath,
      encoding: "buffer",
      maxBuffer: MAX_IMAGE_BYTES
    });
    return stdout;
  } catch {
    return null;
  }
}
async function readWorkingBuffer(repoPath, filePath) {
  try {
    const buf = await promises.readFile(path.join(repoPath, filePath));
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}
function bufferToDataUrl(buf, mime) {
  return `data:${mime};base64,${buf.toString("base64")}`;
}
async function imageDataUrls(repoPath, filePath, mime, oldRef, headRef) {
  const oldBuf = oldRef ? await showFileBuffer(repoPath, oldRef, filePath) : null;
  const newBuf = headRef ? await showFileBuffer(repoPath, headRef, filePath) : await readWorkingBuffer(repoPath, filePath);
  return {
    oldImage: oldBuf ? bufferToDataUrl(oldBuf, mime) : void 0,
    newImage: newBuf ? bufferToDataUrl(newBuf, mime) : void 0
  };
}
function synthesizeAddedFilePatch(filePath, contents) {
  const hasFinalNewline = contents.endsWith("\n");
  const body = hasFinalNewline ? contents.slice(0, -1) : contents;
  const lines = body.length === 0 ? [] : body.split("\n");
  if (lines.length === 0) return "";
  const out = [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`)
  ];
  if (!hasFinalNewline) out.push("\\ No newline at end of file");
  return out.join("\n") + "\n";
}
async function getStashDiff(repoPath, filePath, ref) {
  const git = openGit(repoPath);
  const hasUntracked = await revExists$1(git, `${ref}^3`);
  const isUntracked = hasUntracked && await git.raw(["cat-file", "-e", `${ref}^3:${filePath}`]).then(() => true).catch(() => false);
  const oldRef = isUntracked ? void 0 : `${ref}^1`;
  const newRef = isUntracked ? `${ref}^3` : ref;
  let patch = "";
  let oldContents = oldRef ? await showFile(git, oldRef, filePath) : "";
  let newContents = await showFile(git, newRef, filePath);
  const numstatRaw = isUntracked ? await git.raw(["diff", "--numstat", EMPTY_TREE, `${ref}^3`, "--", filePath]).catch(() => "") : await git.raw(["diff", "--numstat", `${ref}^1`, ref, "--", filePath]).catch(() => "");
  const ns = parseNumstat(numstatRaw).get(filePath) ?? {
    additions: 0,
    deletions: 0,
    binary: false
  };
  const isBinary = ns.binary;
  if (!isUntracked) {
    patch = await git.raw(["diff", `${ref}^1`, ref, "--", filePath]).catch(() => "");
  }
  const imageMime = imageMimeForPath(filePath);
  let oldImage;
  let newImage;
  if (imageMime) {
    ({ oldImage, newImage } = await imageDataUrls(repoPath, filePath, imageMime, oldRef, newRef));
  }
  const hasOld = oldContents.length > 0 || oldImage !== void 0;
  const hasNew = newContents.length > 0 || newImage !== void 0;
  let status;
  if (hasNew && !hasOld) status = "added";
  else if (hasOld && !hasNew) status = "deleted";
  else status = "modified";
  const truncated = tooLargeToRender(oldContents, newContents);
  const dropTextContents = isBinary && imageMime !== null;
  if (isUntracked && !patch && status === "added" && !isBinary && imageMime === null && !truncated && newContents) {
    patch = synthesizeAddedFilePatch(filePath, newContents);
  }
  if (truncated || dropTextContents) {
    oldContents = "";
    newContents = "";
  }
  return {
    file: {
      path: filePath,
      oldPath: void 0,
      status,
      additions: ns.additions,
      deletions: ns.deletions,
      isBinary
    },
    patch,
    oldContents,
    newContents,
    truncated,
    oldImage,
    newImage
  };
}
async function getDiff(repoPath, filePath, ctx) {
  const git = openGit(repoPath);
  if (ctx.kind === "stash") return getStashDiff(repoPath, filePath, ctx.ref);
  const refs = await refsForContext(git, ctx);
  let patch = "";
  let oldContents = "";
  let newContents = "";
  let isBinary = false;
  let additions = 0;
  let deletions = 0;
  let status;
  let oldSideRef = refs.base;
  if (refs.base && refs.head) {
    const mergeBase2 = (await git.raw(["merge-base", refs.base, refs.head]).catch(() => "")).trim();
    if (mergeBase2) oldSideRef = mergeBase2;
  }
  if (refs.workingTree) {
    patch = await git.diff(["HEAD", "--", filePath]).catch(() => "");
    if (!patch) {
      patch = await git.diff(["--", filePath]).catch(() => "");
    }
    oldContents = await showFile(git, "HEAD", filePath);
    newContents = await readWorkingFile(repoPath, filePath);
    const ns = await safeNumstat(git, void 0, void 0, filePath);
    additions = ns.additions;
    deletions = ns.deletions;
    isBinary = ns.binary;
    if (additions === 0 && deletions === 0 && await isUntrackedFile(git, filePath)) {
      const counted = await countWorkingLines(repoPath, filePath);
      if (counted) {
        additions = counted.additions;
        isBinary = counted.binary;
      }
    }
  } else if (refs.base && refs.head) {
    const [patchOut, oldOut, newOut, ns] = await Promise.all([
      git.raw(["diff", `${refs.base}...${refs.head}`, "--", filePath]).catch(() => ""),
      showFile(git, oldSideRef, filePath),
      showFile(git, refs.head, filePath),
      safeNumstat(git, refs.base, refs.head, filePath)
    ]);
    patch = patchOut;
    oldContents = oldOut;
    newContents = newOut;
    additions = ns.additions;
    deletions = ns.deletions;
    isBinary = ns.binary;
  }
  const imageMime = imageMimeForPath(filePath);
  let oldImage;
  let newImage;
  if (imageMime) {
    const oldRef = refs.workingTree ? "HEAD" : oldSideRef;
    const headRef = refs.workingTree ? void 0 : refs.head;
    ({ oldImage, newImage } = await imageDataUrls(repoPath, filePath, imageMime, oldRef, headRef));
  }
  const hasOld = oldContents.length > 0 || oldImage !== void 0;
  const hasNew = newContents.length > 0 || newImage !== void 0;
  if (hasNew && !hasOld) status = "added";
  else if (hasOld && !hasNew) status = "deleted";
  else status = "modified";
  const truncated = tooLargeToRender(oldContents, newContents);
  const dropTextContents = isBinary && imageMime !== null;
  if (refs.workingTree && !patch && status === "added" && !isBinary && imageMime === null && !truncated && newContents) {
    patch = synthesizeAddedFilePatch(filePath, newContents);
  }
  return {
    file: {
      path: filePath,
      oldPath: void 0,
      status,
      additions,
      deletions,
      isBinary
    },
    patch,
    oldContents: truncated || dropTextContents ? "" : oldContents,
    newContents: truncated || dropTextContents ? "" : newContents,
    truncated,
    oldImage,
    newImage
  };
}
async function detectDefaultBranch(git) {
  try {
    const head = (await git.raw(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    if (head) return head.replace(/^origin\//, "");
  } catch {
  }
  const candidates = ["origin/main", "origin/master", "origin/trunk", "main", "master", "trunk"];
  for (const ref of candidates) {
    try {
      await git.raw(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref.replace(/^origin\//, "");
    } catch {
    }
  }
  return void 0;
}
async function getDefaultBranch(repoPath) {
  return detectDefaultBranch(openGit(repoPath));
}
async function countAheadOfDefault(git, branch, defaultBranch, hasRemote) {
  if (!defaultBranch || branch === defaultBranch) return 0;
  const ref = await resolveDefaultRef(git, defaultBranch, hasRemote);
  if (!ref) return 0;
  try {
    const out = (await git.raw(["rev-list", "--count", `${ref}..HEAD`])).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}
async function resolveDefaultRef(git, defaultBranch, hasRemote) {
  const candidates = hasRemote ? [`origin/${defaultBranch}`, defaultBranch] : [defaultBranch];
  for (const ref of candidates) {
    try {
      await git.raw(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
    }
  }
  return null;
}
async function countBehindDefault(git, branch, defaultBranch, hasRemote) {
  if (!defaultBranch || branch === defaultBranch) return 0;
  const ref = await resolveDefaultRef(git, defaultBranch, hasRemote);
  if (!ref) return 0;
  try {
    const out = (await git.raw(["rev-list", "--count", `HEAD..${ref}`])).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}
async function getPushStatus(repoPath, defaultBranch) {
  const git = openGit(repoPath);
  let branch;
  try {
    branch = (await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() || null;
  } catch {
    branch = null;
  }
  const remotes = await git.getRemotes(true).catch(() => []);
  const hasRemote = remotes.some((r) => r.name === "origin");
  const effectiveDefault = defaultBranch ?? await detectDefaultBranch(git);
  const aheadOfDefault = branch ? await countAheadOfDefault(git, branch, effectiveDefault, hasRemote) : 0;
  const behindDefault = branch ? await countBehindDefault(git, branch, effectiveDefault, hasRemote) : 0;
  if (!branch || !hasRemote) {
    return {
      branch,
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      hasRemote,
      aheadOfDefault,
      behindDefault
    };
  }
  let upstream;
  try {
    upstream = (await git.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
  } catch {
    upstream = null;
  }
  if (!upstream) {
    return {
      branch,
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      hasRemote,
      aheadOfDefault,
      behindDefault
    };
  }
  let ahead = 0;
  let behind = 0;
  try {
    const counts = (await git.raw(["rev-list", "--left-right", "--count", `${upstream}...HEAD`])).trim();
    const [b, a] = counts.split(/\s+/).map((n) => Number(n) || 0);
    behind = b;
    ahead = a;
  } catch {
  }
  let pushRemote;
  try {
    pushRemote = (await git.raw(["config", "--get", `branch.${branch}.remote`])).trim() || void 0;
  } catch {
    pushRemote = void 0;
  }
  return {
    branch,
    ahead,
    behind,
    hasUpstream: true,
    hasRemote,
    aheadOfDefault,
    behindDefault,
    pushRemote
  };
}
async function listUnmergedPaths(git) {
  try {
    const raw = await git.raw(["diff", "--name-only", "--diff-filter=U"]);
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
const OVERWRITE_RE = /your local changes to the following files would be overwritten by (merge|checkout):/i;
function parseOverwriteBlocked(message) {
  if (!OVERWRITE_RE.test(message)) return null;
  return message.split("\n").filter((l) => l.startsWith("	")).map((l) => l.slice(1).trimEnd()).filter(Boolean);
}
async function pullImpl(repoPath) {
  const remoteUrl = await originRemoteUrl(openGit(repoPath));
  const git = authedGit(repoPath, remoteUrl);
  try {
    await git.raw(["pull", "--no-rebase", "--no-edit"]);
    return { ok: true, conflicts: [] };
  } catch (err) {
    const conflicts = await listUnmergedPaths(git);
    if (conflicts.length > 0) return { ok: false, conflicts };
    const message = err instanceof Error ? err.message : String(err);
    const blockedFiles = parseOverwriteBlocked(message);
    if (blockedFiles && blockedFiles.length > 0) {
      return { ok: false, conflicts: [], blockedFiles };
    }
    return {
      ok: false,
      conflicts: [],
      error: message
    };
  }
}
async function hasMergeHead(git) {
  try {
    const out = await git.raw(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}
async function dropAutostashBackup(git) {
  const list = await git.raw(["stash", "list"]).catch(() => "");
  if (/^stash@\{0\}:.*autostash/m.test(list)) {
    await git.raw(["stash", "drop"]).catch(() => {
    });
  }
}
async function mergeIntoCurrentImpl(repoPath, ref) {
  const git = openGit(repoPath);
  try {
    await git.raw(["merge", "--no-edit", "--autostash", ref]);
  } catch (err) {
    const conflicts2 = await listUnmergedPaths(git);
    if (conflicts2.length > 0) return { ok: false, conflicts: conflicts2 };
    return {
      ok: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
  const conflicts = await listUnmergedPaths(git);
  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, conflicts: [] };
}
async function ensureUpstreamRemote(git, url) {
  const remotes = await git.getRemotes(true).catch(() => []);
  const existing = remotes.find((r) => r.name === "upstream");
  if (!existing) {
    await git.addRemote("upstream", url);
  } else if (existing.refs.fetch !== url) {
    await git.remote(["set-url", "upstream", url]);
  }
}
async function addUpstreamRemote(repoPath, url) {
  await ensureUpstreamRemote(openGit(repoPath), url);
}
async function removeUpstreamRemote(repoPath) {
  const git = openGit(repoPath);
  const remotes = await git.getRemotes().catch(() => []);
  if (remotes.some((r) => r.name === "upstream")) {
    await git.removeRemote("upstream");
  }
}
async function updateFromUpstreamImpl(repoPath, upstreamUrl, branch) {
  const git = authedGit(repoPath, upstreamUrl);
  try {
    await ensureUpstreamRemote(git, upstreamUrl);
    await git.fetch(["upstream", branch]);
  } catch (err) {
    return {
      ok: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
  return mergeIntoCurrent(repoPath, `upstream/${branch}`);
}
async function pushImpl(repoPath) {
  try {
    const status = await getPushStatus(repoPath);
    if (!status.branch) throw new Error("Not on a branch (detached HEAD).");
    if (!status.hasRemote) throw new Error("No 'origin' remote configured.");
    const remoteUrl = await originRemoteUrl(openGit(repoPath));
    const git = authedGit(repoPath, remoteUrl);
    const args = ["push"];
    if (!status.hasUpstream) args.push("--set-upstream", "origin", status.branch);
    await git.raw(args);
    return { ok: true, conflicts: [] };
  } catch (err) {
    return {
      ok: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function getConflicts(repoPath) {
  return listUnmergedPaths(openGit(repoPath));
}
async function recheckConflicts(repoPath, files) {
  const git = openGit(repoPath);
  const hasMarkers = (content) => /^<{7}|^>{7}/m.test(content);
  for (const f of files) {
    const content = await promises.readFile(path.join(repoPath, f), "utf8").catch(() => "");
    if (content !== "" && !hasMarkers(content)) {
      await git.add([f]).catch(() => {
      });
    }
  }
  return listUnmergedPaths(git);
}
async function stageFileImpl(repoPath, filePath) {
  const git = openGit(repoPath);
  try {
    await git.add([filePath]);
  } catch (err) {
    if (isIgnoredPathAdd(err)) {
      await git.raw(["add", "-A", "-f", "--", filePath]).catch((e) => {
        if (!isPathspecMismatch(e)) throw e;
      });
      return;
    }
    if (!isBeyondSymlink(err)) throw err;
    await git.raw(["rm", "--cached", "--", filePath]).catch(() => {
    });
  }
}
async function pathExistsInHead(git, relPath) {
  try {
    await git.raw(["cat-file", "-e", `HEAD:${relPath}`]);
    return true;
  } catch {
    return false;
  }
}
async function discardChangesImpl(repoPath, filePath, oldPath, trash) {
  await discardFilesImpl(repoPath, [{ path: filePath, oldPath }], trash);
}
const DISCARD_PATH_BATCH = 500;
async function discardFilesImpl(repoPath, files, trash) {
  const git = openGit(repoPath);
  const paths = /* @__PURE__ */ new Set();
  for (const f of files) {
    paths.add(f.path);
    if (f.oldPath && f.oldPath !== f.path) paths.add(f.oldPath);
  }
  if (paths.size === 0) return;
  const all = [...paths];
  const inHead = await Promise.all(all.map((p) => pathExistsInHead(git, p)));
  const tracked = all.filter((_, i) => inHead[i]);
  const untracked = all.filter((_, i) => !inHead[i]);
  for (const batch of chunkPaths(all)) {
    await git.raw(["reset", "-q", "HEAD", "--", ...batch]).catch(() => {
    });
  }
  for (const batch of chunkPaths(tracked)) {
    await git.raw(["checkout", "HEAD", "--", ...batch]);
  }
  for (const rel of untracked) {
    const absPath = path.join(repoPath, rel);
    if (trash) {
      await trash(absPath).catch(() => {
      });
    } else {
      await promises.rm(absPath, { force: true }).catch(() => {
      });
    }
  }
}
function chunkPaths(paths) {
  const out = [];
  for (let i = 0; i < paths.length; i += DISCARD_PATH_BATCH) {
    out.push(paths.slice(i, i + DISCARD_PATH_BATCH));
  }
  return out;
}
async function discardLinesImpl(repoPath, patch) {
  const git = openGit(repoPath);
  const gitDir = (await git.raw(["rev-parse", "--absolute-git-dir"])).trim();
  const patchPath = path.join(gitDir, `super-review-discard-${process.pid}-${Date.now()}.patch`);
  const text2 = patch.endsWith("\n") ? patch : `${patch}
`;
  try {
    await promises.writeFile(patchPath, text2, "utf8");
    await git.raw(["apply", "--whitespace=nowarn", patchPath]);
  } finally {
    await promises.rm(patchPath, { force: true }).catch(() => {
    });
  }
}
async function addToGitignoreImpl(repoPath, patterns) {
  if (patterns.length === 0) return;
  const gitignorePath = path.join(repoPath, ".gitignore");
  const existing = await promises.readFile(gitignorePath, "utf8").catch(() => "");
  const present = new Set(
    existing.split("\n").map((l) => l.trim()).filter(Boolean)
  );
  const toAdd = patterns.filter((p) => !present.has(p.trim()));
  if (toAdd.length === 0) return;
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await promises.appendFile(gitignorePath, `${prefix}${toAdd.join("\n")}
`, "utf8");
}
async function continueMergeImpl(repoPath) {
  const git = openGit(repoPath);
  let remaining = await listUnmergedPaths(git);
  if (remaining.length > 0) return { ok: false, conflicts: remaining };
  if (!await hasMergeHead(git)) {
    await dropAutostashBackup(git);
    return { ok: true, conflicts: [] };
  }
  try {
    await git.raw(["commit", "--no-edit"]);
  } catch (err) {
    return {
      ok: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
  remaining = await listUnmergedPaths(git);
  if (remaining.length > 0) return { ok: false, conflicts: remaining };
  return { ok: true, conflicts: [] };
}
async function abortMergeImpl(repoPath) {
  const git = openGit(repoPath);
  if (await hasMergeHead(git)) {
    await git.raw(["merge", "--abort"]).catch(() => {
    });
    return;
  }
  const list = await git.raw(["stash", "list"]).catch(() => "");
  if (/^stash@\{0\}:.*autostash/m.test(list)) {
    await git.raw(["reset", "--hard", "ORIG_HEAD"]).catch(() => {
    });
    await git.raw(["stash", "pop"]).catch(() => {
    });
  }
}
function managedStashMarker(branch) {
  return `!!super-review${branch}`;
}
async function createManagedStashImpl(repoPath, branch) {
  const git = openGit(repoPath);
  try {
    await git.raw(["stash", "push", "--include-untracked", "-m", managedStashMarker(branch)]);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/no local changes to save/i.test(message)) return { ok: true };
    return { ok: false, error: message };
  }
}
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
async function countStashFiles(git, sha) {
  const seen = /* @__PURE__ */ new Set();
  const tracked = await git.raw(["diff", "--name-only", `${sha}^1`, sha]).catch(() => "");
  for (const l of tracked.split("\n").map((s) => s.trim()).filter(Boolean))
    seen.add(l);
  if (await revExists$1(git, `${sha}^3`)) {
    const untracked = await git.raw(["diff", "--name-only", EMPTY_TREE, `${sha}^3`]).catch(() => "");
    for (const l of untracked.split("\n").map((s) => s.trim()).filter(Boolean))
      seen.add(l);
  }
  return seen.size;
}
async function resolveStashRef(git, sha) {
  const raw = await git.raw(["stash", "list", "--format=%H %gd"]).catch(() => "");
  for (const line of raw.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const sep = line.indexOf(" ");
    if (sep === -1) continue;
    if (line.slice(0, sep) === sha) return line.slice(sep + 1).trim();
  }
  return null;
}
async function findManagedStash(repoPath, branch) {
  const git = openGit(repoPath);
  const marker = managedStashMarker(branch);
  const raw = await git.raw(["stash", "list", "--format=%H %gs"]).catch(() => "");
  const shas = [];
  for (const line of raw.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const sep = line.indexOf(" ");
    if (sep === -1) continue;
    const sha = line.slice(0, sep);
    const subject = line.slice(sep + 1);
    if (subject.includes(marker)) shas.push(sha);
  }
  if (shas.length !== 1) return null;
  const fileCount = await countStashFiles(git, shas[0]);
  return { ref: shas[0], fileCount };
}
async function pathExists$1(p) {
  try {
    await promises.access(p);
    return true;
  } catch {
    return false;
  }
}
async function stashUntrackedFiles(git, sha) {
  if (!await revExists$1(git, `${sha}^3`)) return [];
  const raw = await git.raw(["diff", "--name-only", EMPTY_TREE, `${sha}^3`]).catch(() => "");
  return raw.split("\n").map((s) => s.trim()).filter(Boolean);
}
async function collidingStashUntracked(repoPath, git, sha) {
  const untracked = await stashUntrackedFiles(git, sha);
  const colliding = [];
  for (const rel of untracked) {
    if (await pathExists$1(path.join(repoPath, rel))) colliding.push(rel);
  }
  return colliding;
}
async function restoreManagedStashImpl(repoPath, sha) {
  const git = openGit(repoPath);
  const ref = await resolveStashRef(git, sha);
  if (!ref) {
    return { ok: false, conflicts: [], error: "The stashed changes are no longer available." };
  }
  const blockedFiles = await collidingStashUntracked(repoPath, git, sha);
  if (blockedFiles.length > 0) {
    return {
      ok: false,
      conflicts: [],
      blockedFiles,
      error: "Some files this stash saved already exist in your working tree."
    };
  }
  let applyError = null;
  try {
    await git.raw(["stash", "apply", ref]);
  } catch (err) {
    applyError = err;
  }
  const conflicts = await listUnmergedPaths(git);
  if (conflicts.length > 0) return { ok: false, conflicts };
  if (applyError) {
    return {
      ok: false,
      conflicts: [],
      error: applyError instanceof Error ? applyError.message : String(applyError)
    };
  }
  await dropStashBySha(git, sha);
  return { ok: true, conflicts: [] };
}
async function restoreManagedStashKeepingLocalImpl(repoPath, sha) {
  const git = openGit(repoPath);
  const ref = await resolveStashRef(git, sha);
  if (!ref) {
    return { ok: false, conflicts: [], error: "The stashed changes are no longer available." };
  }
  const untracked = await stashUntrackedFiles(git, sha);
  const toRestore = [];
  for (const rel of untracked) {
    if (!await pathExists$1(path.join(repoPath, rel))) toRestore.push(rel);
  }
  if (toRestore.length > 0) {
    await git.raw(["checkout", `${sha}^3`, "--", ...toRestore]);
    await git.raw(["reset", "--quiet", "--", ...toRestore]).catch(() => {
    });
  }
  const patch = await git.raw(["diff", `${sha}^1`, sha]).catch(() => "");
  let applyError = null;
  if (patch.trim().length > 0) {
    const patchFile = path.join(os.tmpdir(), `super-review-stash-${sha}.patch`);
    await promises.writeFile(patchFile, patch);
    try {
      await git.raw(["apply", "--3way", patchFile]);
    } catch (err) {
      applyError = err;
    } finally {
      await promises.rm(patchFile, { force: true }).catch(() => {
      });
    }
  }
  const conflicts = await listUnmergedPaths(git);
  if (conflicts.length > 0) return { ok: false, conflicts };
  if (applyError) {
    return {
      ok: false,
      conflicts: [],
      error: applyError instanceof Error ? applyError.message : String(applyError)
    };
  }
  await dropStashBySha(git, sha);
  return { ok: true, conflicts: [] };
}
async function dropStashBySha(git, sha) {
  const live = await resolveStashRef(git, sha);
  if (live) await git.raw(["stash", "drop", live]).catch(() => {
  });
}
async function discardManagedStashImpl(repoPath, sha) {
  const git = openGit(repoPath);
  const ref = await resolveStashRef(git, sha);
  if (ref) await git.raw(["stash", "drop", ref]);
}
async function finishStashPopImpl(repoPath, sha) {
  const git = openGit(repoPath);
  const remaining = await listUnmergedPaths(git);
  if (remaining.length > 0) return { ok: false, conflicts: remaining };
  const ref = await resolveStashRef(git, sha);
  if (ref) await git.raw(["stash", "drop", ref]).catch(() => {
  });
  return { ok: true, conflicts: [] };
}
async function abortStashPopImpl(repoPath) {
  const git = openGit(repoPath);
  await git.raw(["checkout", "--", "."]).catch(() => {
  });
  await git.raw(["reset", "--hard", "HEAD"]).catch(() => {
  });
}
function isPathspecMismatch(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /did not match any file/.test(msg);
}
function isBeyondSymlink(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /beyond a symbolic link/.test(msg);
}
function isIgnoredPathAdd(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /ignored by one of your \.gitignore files/.test(msg);
}
let sshSigningSupported = null;
function parseVersion(s) {
  const m = s.match(/(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function atLeast(v, major, minor) {
  if (!v) return false;
  return v[0] > major || v[0] === major && v[1] >= minor;
}
async function checkSshSigningSupported() {
  if (sshSigningSupported !== null) return sshSigningSupported;
  sshSigningSupported = await (async () => {
    try {
      const { stdout: gitOut } = await execFileAsync$4("git", ["--version"]);
      if (!atLeast(parseVersion(gitOut), 2, 34)) return false;
      const { stdout, stderr } = await execFileAsync$4("ssh", ["-V"]);
      const m = (stderr + stdout).match(/OpenSSH[_-](\d+)\.(\d+)/);
      return atLeast(m ? [Number(m[1]), Number(m[2])] : null, 8, 0);
    } catch {
      return false;
    }
  })();
  return sshSigningSupported;
}
function sshSignConfigArgs(signing) {
  if (!signing) return [];
  return [
    "-c",
    "gpg.format=ssh",
    "-c",
    `user.signingkey=${signing.keyPath}`,
    "-c",
    "commit.gpgsign=true"
  ];
}
async function runSignedOrFallback(signing, run) {
  if (!signing) return run([], []);
  try {
    return await run(sshSignConfigArgs(signing), ["-S"]);
  } catch {
    return run([], []);
  }
}
async function commitImpl(repoPath, message, files, identity, signing) {
  const git = openGit(repoPath);
  try {
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Commit message is required.");
    if (files.length === 0) throw new Error("No files selected to commit.");
    const hasPartial = files.some((f) => f.patch != null && f.patch.trim() !== "");
    if (!hasPartial) {
      const paths = [];
      for (const f of files) {
        paths.push(f.path);
        if (f.oldPath && f.oldPath !== f.path) paths.push(f.oldPath);
      }
      for (const p of paths) {
        try {
          await git.raw(["add", "-A", "--", p]);
        } catch (err) {
          if (isIgnoredPathAdd(err)) {
            await git.raw(["add", "-A", "-f", "--", p]).catch((e) => {
              if (!isPathspecMismatch(e)) throw e;
            });
            continue;
          }
          if (isBeyondSymlink(err)) {
            await commitPartial(repoPath, trimmed, files, identity, signing);
            return { ok: true, ...await headCommitStats(git, repoPath) };
          }
          if (!isPathspecMismatch(err)) throw err;
        }
      }
      const identityArgs = identity ? ["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`] : [];
      await runSignedOrFallback(
        signing,
        (cfg, sign) => git.raw([...cfg, ...identityArgs, "commit", ...sign, "-m", trimmed, "--", ...paths])
      );
      return { ok: true, ...await headCommitStats(git, repoPath) };
    }
    await commitPartial(repoPath, trimmed, files, identity, signing);
    return { ok: true, ...await headCommitStats(git, repoPath) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function headCommitStats(git, repoPath) {
  try {
    const hasParent = await git.raw(["rev-parse", "--verify", "--quiet", "HEAD^"]).then(() => true).catch(() => false);
    const range = hasParent ? ["HEAD^", "HEAD"] : [EMPTY_TREE, "HEAD"];
    const map = parseNumstat(await git.raw(["diff", "--numstat", ...range]));
    let filesCommitted = 0;
    let linesCommitted = 0;
    for (const row of map.values()) {
      filesCommitted++;
      linesCommitted += row.additions + row.deletions;
    }
    return { filesCommitted, linesCommitted, lastCommit: await getLastCommit(repoPath) };
  } catch {
    return { filesCommitted: 0, linesCommitted: 0, lastCommit: null };
  }
}
async function commitPartial(repoPath, message, files, identity, signing) {
  const baseGit = openGit(repoPath);
  const gitDir = (await baseGit.raw(["rev-parse", "--absolute-git-dir"])).trim();
  const headExists2 = await revExists$1(baseGit, "HEAD");
  const unique = `${process.pid}-${Date.now()}`;
  const tmpIndex = path.join(gitDir, `super-review-index-${unique}`);
  const tmpPatchFiles = [];
  const baseEnv = { ...process.env };
  stripEditorEnv(baseEnv);
  const indexEnv = { ...baseEnv, GIT_INDEX_FILE: tmpIndex };
  const idxGit = openGit(repoPath).env(indexEnv);
  try {
    await idxGit.raw(headExists2 ? ["read-tree", "HEAD"] : ["read-tree", "--empty"]);
    for (const f of files) {
      if (f.patch != null && f.patch.trim() !== "") {
        const patchPath = path.join(
          gitDir,
          `super-review-patch-${unique}-${tmpPatchFiles.length}.patch`
        );
        const text2 = f.patch.endsWith("\n") ? f.patch : `${f.patch}
`;
        await promises.writeFile(patchPath, text2, "utf8");
        tmpPatchFiles.push(patchPath);
        await idxGit.raw(["apply", "--cached", "--whitespace=nowarn", patchPath]);
      } else {
        const paths = [f.path];
        if (f.oldPath && f.oldPath !== f.path) paths.push(f.oldPath);
        try {
          await idxGit.raw(["add", "-A", "--", ...paths]);
        } catch (err) {
          if (isIgnoredPathAdd(err)) {
            await idxGit.raw(["add", "-A", "-f", "--", ...paths]).catch((e) => {
              if (!isPathspecMismatch(e)) throw e;
            });
            continue;
          }
          if (!isBeyondSymlink(err)) throw err;
          for (const p of paths) {
            await idxGit.raw(["rm", "--cached", "--", p]).catch(() => {
            });
          }
        }
      }
    }
    const tree = (await idxGit.raw(["write-tree"])).trim();
    const commitEnv = { ...indexEnv };
    if (identity) {
      commitEnv.GIT_AUTHOR_NAME = identity.name;
      commitEnv.GIT_AUTHOR_EMAIL = identity.email;
      commitEnv.GIT_COMMITTER_NAME = identity.name;
      commitEnv.GIT_COMMITTER_EMAIL = identity.email;
    }
    const parentArgs = headExists2 ? ["-p", "HEAD"] : [];
    const newSha = (await runSignedOrFallback(
      signing,
      (cfg, sign) => openGit(repoPath).env(commitEnv).raw([...cfg, "commit-tree", ...sign, tree, "-m", message, ...parentArgs])
    )).trim();
    await baseGit.raw(["update-ref", "HEAD", newSha]);
    const touched = [];
    for (const f of files) {
      touched.push(f.path);
      if (f.oldPath && f.oldPath !== f.path) touched.push(f.oldPath);
    }
    await baseGit.raw(["reset", "-q", "HEAD", "--", ...touched]).catch(() => {
    });
  } finally {
    await promises.rm(tmpIndex, { force: true }).catch(() => {
    });
    for (const p of tmpPatchFiles) await promises.rm(p, { force: true }).catch(() => {
    });
  }
}
async function getLastCommit(repoPath) {
  const git = openGit(repoPath);
  try {
    const raw = (await git.raw(["log", "-1", "--pretty=format:%H%x1f%s%x1f%cr%x1f%b"])).trim();
    if (!raw) return null;
    const [hash2, subject, relativeTime, ...rest] = raw.split("");
    const body = rest.join("").trim();
    let unpushedCount = 1;
    try {
      unpushedCount = Number((await git.raw(["rev-list", "--count", "HEAD", "--not", "--remotes"])).trim()) || 0;
    } catch {
      unpushedCount = 1;
    }
    return { hash: hash2, subject, body, relativeTime, canUndo: unpushedCount > 0, unpushedCount };
  } catch {
    return null;
  }
}
function numstatNewPath(p) {
  if (!p.includes(" => ")) return p;
  const open = p.indexOf("{");
  const close = p.indexOf("}", open);
  if (open === -1 || close === -1) return p.slice(p.indexOf(" => ") + 4);
  const inner = p.slice(open + 1, close);
  const arrow = inner.indexOf(" => ");
  const to = arrow === -1 ? inner : inner.slice(arrow + 4);
  return `${p.slice(0, open)}${to}${p.slice(close + 1)}`.replace(/\/{2,}/g, "/");
}
function splitLogRecords(raw) {
  const records = [];
  for (const chunk of raw.split("")) {
    if (!chunk.trim()) continue;
    const [header, ...rest] = chunk.split("\n");
    records.push({ fields: header.split(""), lines: rest.filter((l) => l.trim().length > 0) });
  }
  return records;
}
function statusFromCode(code) {
  if (code.startsWith("A")) return "added";
  if (code.startsWith("D")) return "deleted";
  if (code.startsWith("R")) return "renamed";
  if (code.startsWith("C")) return "copied";
  if (code.startsWith("T")) return "type-change";
  return "modified";
}
async function listLocalCommits(repoPath, limit = LOCAL_COMMITS_LIMIT) {
  const git = openGit(repoPath);
  const args = [
    "log",
    `--max-count=${Math.max(1, Math.floor(limit))}`,
    "--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s",
    "--find-renames",
    "HEAD",
    "--not",
    "--remotes"
  ];
  try {
    const [numstatRaw, nameStatusRaw] = await Promise.all([
      git.raw([...args, "--numstat"]),
      git.raw([...args, "--name-status"])
    ]);
    const statusByCommit = /* @__PURE__ */ new Map();
    for (const record of splitLogRecords(nameStatusRaw)) {
      const hash2 = record.fields[0];
      if (!hash2) continue;
      const files = /* @__PURE__ */ new Map();
      for (const line of record.lines) {
        const parts = line.split("	");
        const status = statusFromCode(parts[0]);
        const renamed = status === "renamed" || status === "copied";
        const p = renamed ? parts[2] : parts[1];
        if (!p) continue;
        files.set(p, { status, oldPath: renamed ? parts[1] : void 0 });
      }
      statusByCommit.set(hash2, files);
    }
    const commits = [];
    for (const record of splitLogRecords(numstatRaw)) {
      const [hash2, shortHash, authorName, authorEmail, at, ...rest] = record.fields;
      if (!hash2) continue;
      const statuses = statusByCommit.get(hash2);
      const files = [];
      let additions = 0;
      let deletions = 0;
      for (const line of record.lines) {
        const [a, d, ...pathParts] = line.split("	");
        const p = numstatNewPath(pathParts.join("	"));
        if (!p) continue;
        const isBinary = a === "-" && d === "-";
        const adds = isBinary ? 0 : Number(a) || 0;
        const dels = isBinary ? 0 : Number(d) || 0;
        additions += adds;
        deletions += dels;
        const known = statuses?.get(p);
        files.push({
          path: p,
          oldPath: known?.oldPath,
          status: known?.status ?? "modified",
          additions: adds,
          deletions: dels,
          isBinary
        });
      }
      commits.push({
        hash: hash2,
        shortHash,
        authorName,
        authorEmail,
        authoredAt: Number(at) * 1e3,
        subject: rest.join(""),
        additions,
        deletions,
        files
      });
    }
    return commits;
  } catch {
    return [];
  }
}
async function listCommits(repoPath, head = "HEAD", limit = 2e3) {
  const git = openGit(repoPath);
  try {
    const raw = await git.raw([
      "log",
      `--max-count=${Math.max(1, Math.floor(limit))}`,
      "--pretty=format:%H%h%an%ae%at%s",
      head
    ]);
    const commits = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const [hash2, shortHash, authorName, authorEmail, at, ...rest] = line.split("");
      if (!hash2) continue;
      commits.push({
        hash: hash2,
        shortHash,
        authorName,
        authorEmail,
        authoredAt: Number(at) * 1e3,
        subject: rest.join("")
      });
    }
    return commits;
  } catch {
    return [];
  }
}
async function mergeBase(repoPath, a, b) {
  const git = openGit(repoPath);
  try {
    const sha = (await git.raw(["merge-base", a, b])).trim();
    return sha || null;
  } catch {
    return null;
  }
}
async function undoLastCommitImpl(repoPath) {
  const git = openGit(repoPath);
  try {
    const count = Number((await git.raw(["rev-list", "--count", "HEAD"])).trim()) || 0;
    if (count <= 0) throw new Error("No commit to undo.");
    if (count === 1) {
      await git.raw(["update-ref", "-d", "HEAD"]);
    } else {
      await git.raw(["reset", "--soft", "HEAD~1"]);
    }
    return { ok: true, lastCommit: await getLastCommit(repoPath) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function cloneRepo(url, parentDir) {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "Repository URL is required." };
  const name = trimmed.replace(/\.git$/, "").split(/[/:]/).pop();
  if (!name) return { ok: false, error: "Could not parse repository name from URL." };
  const target = path.join(parentDir, name);
  try {
    const exists2 = await promises.stat(target).then(() => true).catch(() => false);
    if (exists2) {
      return { ok: false, error: `Destination already exists: ${target}` };
    }
    await authedGit(null, trimmed).clone(trimmed, target);
    return { ok: true, path: target };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function createRepo(opts) {
  const name = opts.name.trim();
  if (!name) return { ok: false, error: "Repository name is required." };
  if (/[/\\]/.test(name) || name === "." || name === "..") {
    return { ok: false, error: `Invalid repository name: ${name}` };
  }
  const parent = opts.path.trim();
  if (!parent) return { ok: false, error: "Local path is required." };
  const target = path.join(parent, name);
  try {
    const existing = await promises.stat(target).catch(() => null);
    if (existing) {
      if (!existing.isDirectory()) {
        return { ok: false, error: `Not a directory: ${target}` };
      }
      if (await isGitRepo(target)) {
        return {
          ok: false,
          error: `A repository already exists at: ${target}`
        };
      }
      const entries = await promises.readdir(target);
      if (entries.length > 0) {
        return { ok: false, error: `Directory is not empty: ${target}` };
      }
    } else {
      await promises.mkdir(target, { recursive: true });
    }
    const git = openGit(target);
    await git.init();
    const description = opts.description?.trim() ?? "";
    if (description) {
      await promises.writeFile(path.join(target, ".git", "description"), `${description}
`).catch(() => {
      });
    }
    if (opts.initReadme) {
      const body = description ? `# ${name}

${description}
` : `# ${name}
`;
      await promises.writeFile(path.join(target, "README.md"), body);
    }
    if (opts.gitignore) {
      const content = getGitignore(opts.gitignore);
      if (content) await promises.writeFile(path.join(target, ".gitignore"), content);
    }
    if (opts.license) {
      const author = await readGitUserName(git) || name;
      const content = getLicense(opts.license, {
        year: (/* @__PURE__ */ new Date()).getFullYear(),
        author
      });
      if (content) await promises.writeFile(path.join(target, "LICENSE"), content);
    }
    return { ok: true, path: target };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function readGitUserName(git) {
  try {
    return (await git.raw(["config", "user.name"])).trim();
  } catch {
    return "";
  }
}
async function headExists(git) {
  try {
    await git.raw(["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}
async function ensureInitialCommit(repoPath, message, identity, signing) {
  const git = openGit(repoPath);
  if (await headExists(git)) return false;
  await git.raw(["add", "-A"]);
  const env = { ...process.env };
  stripEditorEnv(env);
  if (identity) {
    env.GIT_AUTHOR_NAME = identity.name;
    env.GIT_AUTHOR_EMAIL = identity.email;
    env.GIT_COMMITTER_NAME = identity.name;
    env.GIT_COMMITTER_EMAIL = identity.email;
  }
  await runSignedOrFallback(
    signing,
    (cfg, sign) => openGit(repoPath).env(env).raw([...cfg, "commit", ...sign, "--allow-empty", "-m", message])
  );
  return true;
}
async function setOriginAndPush(repoPath, remoteUrl) {
  const git = authedGit(repoPath, remoteUrl);
  try {
    const branch = await getCurrentBranch(repoPath);
    if (!branch) throw new Error("Not on a branch (detached HEAD).");
    const remotes = await git.getRemotes().catch(() => []);
    if (remotes.some((r) => r.name === "origin")) {
      await git.raw(["remote", "set-url", "origin", remoteUrl]);
    } else {
      await git.raw(["remote", "add", "origin", remoteUrl]);
    }
    await git.raw(["push", "--set-upstream", "origin", branch]);
    return { ok: true, conflicts: [] };
  } catch (err) {
    return {
      ok: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function convertToForkRemotes(repoPath, forkUrl, upstreamUrl) {
  const git = openGit(repoPath);
  const remotes = await git.getRemotes().catch(() => []);
  if (remotes.some((r) => r.name === "origin")) {
    await git.raw(["remote", "set-url", "origin", forkUrl]);
  } else {
    await git.raw(["remote", "add", "origin", forkUrl]);
  }
  if (upstreamUrl) await ensureUpstreamRemote(git, upstreamUrl);
}
async function fetchOrigin(repoPath) {
  try {
    const remoteUrl = await originRemoteUrl(openGit(repoPath));
    const git = authedGit(repoPath, remoteUrl);
    await git.fetch(["origin", "--prune"]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function fetchPRRef(repoPath, prNumber, remote = "origin") {
  const base = openGit(repoPath);
  const remoteUrl = await resolveRemoteUrl(base, remote);
  const git = authedGit(repoPath, remoteUrl);
  await git.fetch([remote, `+pull/${prNumber}/head:refs/pr/${prNumber}/head`]).catch(() => {
  });
  return {
    headRef: `pr/${prNumber}/head`,
    baseRef: `pr/${prNumber}/base`
  };
}
function isMissingRemoteRef(err) {
  const message = err instanceof Error ? err.message : String(err);
  return /couldn't find remote ref/i.test(message);
}
async function checkoutPRImpl(repoPath, opts) {
  const git = openGit(repoPath);
  const { prNumber, headRef, headRepoUrl, headRepoOwner } = opts;
  const checkoutSnapshot = async () => {
    const local2 = await git.branchLocal();
    if (!local2.all.includes(headRef)) {
      const fallback = opts.fallbackRemote ?? "origin";
      const fallbackUrl = await resolveRemoteUrl(git, fallback);
      await authedGit(repoPath, fallbackUrl).fetch([fallback, `pull/${prNumber}/head:${headRef}`]);
    }
    await git.checkout(headRef);
  };
  if (!headRepoUrl || !headRepoOwner) {
    await checkoutSnapshot();
    return;
  }
  const remote = await ensureRemoteForUrl(git, headRepoOwner, headRepoUrl, opts.originUrl);
  try {
    await authedGit(repoPath, headRepoUrl).fetch([remote, headRef]);
  } catch (err) {
    if (!isMissingRemoteRef(err)) throw err;
    await checkoutSnapshot();
    return;
  }
  const local = await git.branchLocal();
  if (local.all.includes(headRef)) {
    await git.checkout(headRef);
    await git.raw(["branch", `--set-upstream-to=${remote}/${headRef}`, headRef]).catch(() => {
    });
  } else {
    await git.checkout(["-b", headRef, "--track", `${remote}/${headRef}`]);
  }
}
async function sameGithubRepo(a, b) {
  const ga = await parseGithubFromUrl(a);
  const gb = await parseGithubFromUrl(b);
  return !!ga && !!gb && ga.owner.toLowerCase() === gb.owner.toLowerCase() && ga.repo.toLowerCase() === gb.repo.toLowerCase();
}
function sanitizeRemoteName(owner) {
  return owner.replace(/[^A-Za-z0-9._-]/g, "-") || "fork";
}
async function ensureRemoteForUrl(git, owner, url, originUrl) {
  if (originUrl && await sameGithubRepo(originUrl, url)) return "origin";
  const remotes = await git.getRemotes(true).catch(() => []);
  for (const r of remotes) {
    if (r.refs.fetch && await sameGithubRepo(r.refs.fetch, url)) return r.name;
  }
  let name = sanitizeRemoteName(owner);
  if (remotes.some((r) => r.name === name)) name = `pr-${name}`;
  if (remotes.some((r) => r.name === name)) {
    await git.remote(["set-url", name, url]);
  } else {
    await git.addRemote(name, url);
  }
  return name;
}
async function pinPRBaseRefImpl(repoPath, prNumber, baseBranch, remote = "origin") {
  const base = openGit(repoPath);
  const remoteUrl = await resolveRemoteUrl(base, remote);
  const git = authedGit(repoPath, remoteUrl);
  await git.fetch([remote, `+refs/heads/${baseBranch}:refs/pr/${prNumber}/base`]).catch(() => {
  });
}
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
async function pathExists(p) {
  try {
    await promises.access(p);
    return true;
  } catch {
    return false;
  }
}
async function readJson(p) {
  return JSON.parse(await promises.readFile(p, "utf8"));
}
async function readChangesetConfig(repoPath) {
  const configPath = path.join(repoPath, ".changeset", "config.json");
  if (!await pathExists(configPath)) return null;
  try {
    const raw = await readJson(configPath);
    const ignore = Array.isArray(raw.ignore) ? raw.ignore.filter((x) => typeof x === "string") : [];
    const baseBranch = typeof raw.baseBranch === "string" ? raw.baseBranch : void 0;
    const versionsPrivate = raw.privatePackages === false ? false : raw.privatePackages?.version !== false;
    return { ignore, baseBranch, versionsPrivate };
  } catch {
    return { ignore: [], versionsPrivate: true };
  }
}
function parsePnpmWorkspaceGlobs(yaml) {
  const lines = yaml.split(/\r?\n/);
  const globs = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s+(.*\S)\s*$/.exec(line);
    if (item) {
      globs.push(stripQuotes(item[1]));
      continue;
    }
    if (line.trim() !== "") break;
  }
  return globs;
}
function stripQuotes(s) {
  const t = s.trim();
  if (t.length >= 2 && (t.startsWith('"') && t.endsWith('"') || t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
async function workspaceGlobs(repoPath) {
  const pnpm = path.join(repoPath, "pnpm-workspace.yaml");
  if (await pathExists(pnpm)) {
    const globs = parsePnpmWorkspaceGlobs(await promises.readFile(pnpm, "utf8"));
    if (globs.length > 0) return globs;
  }
  try {
    const pkg = await readJson(path.join(repoPath, "package.json"));
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) return ws;
    if (ws && Array.isArray(ws.packages)) return ws.packages;
  } catch {
  }
  return [];
}
async function resolveGlobDirs(repoPath, glob) {
  const segments = glob.split("/").filter((s) => s !== "" && s !== ".");
  let dirs = [""];
  for (const seg of segments) {
    const next = [];
    for (const dir of dirs) {
      const abs = path.join(repoPath, dir);
      if (seg === "*" || seg === "**") {
        let entries;
        try {
          entries = await promises.readdir(abs, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
          const child = dir ? `${dir}/${e.name}` : e.name;
          next.push(child);
          if (seg === "**") dirs.push(child);
        }
      } else {
        const child = dir ? `${dir}/${seg}` : seg;
        try {
          if ((await promises.stat(path.join(repoPath, child))).isDirectory()) next.push(child);
        } catch {
        }
      }
    }
    dirs = next;
  }
  return dirs;
}
async function listWorkspacePackages(repoPath, config) {
  const globs = await workspaceGlobs(repoPath);
  const ignore = new Set(config.ignore);
  if (globs.length === 0) {
    const root = await readWorkspacePackage(repoPath, "", config, ignore);
    return root ? [root] : [];
  }
  const seen = /* @__PURE__ */ new Set();
  const packages = [];
  for (const glob of globs) {
    if (glob.startsWith("!")) continue;
    for (const dir of await resolveGlobDirs(repoPath, glob)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      const pkg = await readWorkspacePackage(repoPath, dir, config, ignore);
      if (pkg) packages.push(pkg);
    }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}
async function readWorkspacePackage(repoPath, dir, config, ignore) {
  let pkg;
  try {
    pkg = await readJson(path.join(repoPath, dir, "package.json"));
  } catch {
    return null;
  }
  if (typeof pkg.name !== "string" || !pkg.name) return null;
  const isPrivate = pkg.private === true;
  if (ignore.has(pkg.name)) return null;
  if (isPrivate && !config.versionsPrivate) return null;
  return { name: pkg.name, dir, private: isPrivate };
}
async function revExists(git, ref) {
  try {
    await git.raw(["rev-parse", "--verify", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
async function changedFilesOnBranch(git, config) {
  const baseName = config.baseBranch ?? await detectDefaultBranch(git).catch(() => void 0) ?? "main";
  const baseRef = await revExists(git, `origin/${baseName}`) ? `origin/${baseName}` : await revExists(git, baseName) ? baseName : null;
  const paths = /* @__PURE__ */ new Set();
  const added = /* @__PURE__ */ new Set();
  let mergeBase2 = null;
  if (baseRef) {
    try {
      mergeBase2 = (await git.raw(["merge-base", baseRef, "HEAD"])).trim() || null;
    } catch {
      mergeBase2 = null;
    }
  }
  if (mergeBase2) {
    const diff = await git.raw(["diff", "--name-status", mergeBase2]).catch(() => "");
    for (const line of diff.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("	");
      const status = parts[0];
      const file = parts[parts.length - 1]?.trim();
      if (!file) continue;
      paths.add(file);
      if (status.startsWith("A")) added.add(file);
    }
  } else {
    const status = await git.raw(["status", "--porcelain", "-z"]).catch(() => "");
    for (const entry of status.split("\0")) {
      if (entry.length > 3) {
        const file = entry.slice(3);
        const code = entry.slice(0, 2);
        paths.add(file);
        if (code === "??" || code[0] === "A") added.add(file);
      }
    }
  }
  const untrackedOut = await git.raw(["ls-files", "--others", "--exclude-standard"]).catch(() => "");
  const untracked = [];
  for (const p of untrackedOut.split("\n")) {
    const file = p.trim();
    if (file) {
      paths.add(file);
      added.add(file);
      untracked.push(file);
    }
  }
  return { files: [...paths], added, untracked, baseRef, mergeBase: mergeBase2 };
}
function isChangesetFile(file) {
  return /^\.changeset\/[^/]+\.md$/i.test(file) && file.toLowerCase() !== ".changeset/readme.md";
}
function packagesForFiles(files, packages) {
  const byDir = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  const changed = /* @__PURE__ */ new Set();
  for (const file of files) {
    if (file.startsWith(".changeset/")) continue;
    for (const pkg of byDir) {
      const prefix = pkg.dir === "" ? "" : `${pkg.dir}/`;
      if (file === pkg.dir || file.startsWith(prefix)) {
        changed.add(pkg.name);
        break;
      }
    }
  }
  return [...changed];
}
function packagesInChangeset(src) {
  const m = FRONTMATTER_RE.exec(src);
  if (!m) return [];
  const names = [];
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    const kv = /^(['"]?)(.+?)\1\s*:\s*(patch|minor|major)\s*$/.exec(line);
    if (kv) names.push(kv[2]);
  }
  return names;
}
async function branchChangesetFiles(repoPath, files, added) {
  const out = [];
  for (const file of files) {
    if (!isChangesetFile(file)) continue;
    try {
      const src = await promises.readFile(path.join(repoPath, file), "utf8");
      out.push({ path: file, packages: packagesInChangeset(src), added: added.has(file) });
    } catch {
    }
  }
  return out;
}
async function getChangesetStatus(repoPath) {
  const empty = {
    installed: false,
    packages: [],
    changedPackages: [],
    coveredPackages: [],
    needsChangeset: false,
    branchChangesets: []
  };
  const config = await readChangesetConfig(repoPath);
  if (!config) return empty;
  const git = simpleGit(repoPath);
  const [packages, changed] = await Promise.all([
    listWorkspacePackages(repoPath, config),
    changedFilesOnBranch(git, config)
  ]);
  const changedFiles = changed.files;
  const branchChangesets = await branchChangesetFiles(repoPath, changedFiles, changed.added);
  const covered = [...new Set(branchChangesets.flatMap((c) => c.packages))];
  const changedPackages = packagesForFiles(changedFiles, packages);
  const coveredSet = new Set(covered);
  const needsChangeset = changedPackages.some((p) => !coveredSet.has(p));
  return {
    installed: true,
    packages,
    changedPackages,
    coveredPackages: covered,
    needsChangeset,
    branchChangesets
  };
}
async function getChangesetBrief(repoPath) {
  const config = await readChangesetConfig(repoPath);
  if (!config) return null;
  const git = simpleGit(repoPath);
  const [packages, changed] = await Promise.all([
    listWorkspacePackages(repoPath, config),
    changedFilesOnBranch(git, config)
  ]);
  const branchChangesets = (await branchChangesetFiles(repoPath, changed.files, changed.added)).map(
    (c) => ({ path: c.path, packages: c.packages })
  );
  const covered = new Set(branchChangesets.flatMap((c) => c.packages));
  const uncoveredPackages = packagesForFiles(changed.files, packages).filter(
    (name) => !covered.has(name)
  );
  return {
    packages,
    uncoveredPackages,
    branchChangesets,
    baseRef: changed.baseRef,
    mergeBase: changed.mergeBase
  };
}
async function readChangesetFiles(repoPath) {
  const dir = path.join(repoPath, ".changeset");
  let entries;
  try {
    entries = await promises.readdir(dir);
  } catch {
    return /* @__PURE__ */ new Map();
  }
  const out = /* @__PURE__ */ new Map();
  for (const name of entries) {
    const relPath = path.posix.join(".changeset", name);
    if (!isChangesetFile(relPath)) continue;
    try {
      const contents = await promises.readFile(path.join(dir, name), "utf8");
      out.set(relPath, { path: relPath, contents, packages: packagesInChangeset(contents) });
    } catch {
    }
  }
  return out;
}
function changesetFilesWritten(before, after) {
  const written = [];
  for (const [relPath, file] of after) {
    const prior = before.get(relPath);
    if (!prior || prior.contents !== file.contents) written.push(file);
  }
  return written.sort((a, b) => a.path.localeCompare(b.path));
}
const ADJECTIVES = [
  "brave",
  "calm",
  "clever",
  "cool",
  "eager",
  "fair",
  "fancy",
  "fast",
  "fresh",
  "gentle",
  "happy",
  "honest",
  "jolly",
  "kind",
  "lazy",
  "lucky",
  "mighty",
  "neat",
  "odd",
  "proud",
  "quiet",
  "rare",
  "rich",
  "shy",
  "silly",
  "slow",
  "small",
  "smart",
  "soft",
  "spicy",
  "strong",
  "sweet",
  "tame",
  "tidy",
  "tough",
  "warm",
  "wild",
  "wise",
  "witty",
  "young"
];
const NOUNS = [
  "apples",
  "badgers",
  "balloons",
  "bottles",
  "boxes",
  "candles",
  "carrots",
  "cats",
  "chairs",
  "clouds",
  "corners",
  "crews",
  "dogs",
  "doors",
  "eagles",
  "falcons",
  "forks",
  "foxes",
  "frogs",
  "geese",
  "ghosts",
  "guests",
  "hotels",
  "islands",
  "jokes",
  "kings",
  "lamps",
  "lemons",
  "lions",
  "masks",
  "mirrors",
  "oranges",
  "otters",
  "pandas",
  "parrots",
  "planes",
  "rings",
  "rivers",
  "rockets",
  "shoes",
  "spiders",
  "tables",
  "teams",
  "tigers",
  "trains",
  "turtles",
  "waves",
  "zebras"
];
const VERBS$1 = [
  "accept",
  "act",
  "bake",
  "begin",
  "bow",
  "build",
  "cheer",
  "climb",
  "cough",
  "dance",
  "dream",
  "drum",
  "fail",
  "fly",
  "glow",
  "grin",
  "grow",
  "hide",
  "hope",
  "hug",
  "jam",
  "jog",
  "jump",
  "kneel",
  "laugh",
  "learn",
  "march",
  "obey",
  "paint",
  "play",
  "pump",
  "race",
  "relax",
  "rescue",
  "rest",
  "rhyme",
  "shop",
  "sing",
  "sip",
  "smile",
  "sneeze",
  "sort",
  "study",
  "swim",
  "travel",
  "turn",
  "wait",
  "wave",
  "wink",
  "yawn"
];
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomSlug() {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(VERBS$1)}`;
}
async function createChangeset(repoPath, input) {
  const entries = input.packages.filter((p) => p.trim() !== "").map((name) => ({ name, bump: input.bump }));
  return writeChangesetFile(repoPath, entries, input.description, input.name);
}
async function writeChangesetFile(repoPath, entries, description, name) {
  if (entries.length === 0) throw new Error("A changeset needs at least one package.");
  const dir = path.join(repoPath, ".changeset");
  await promises.mkdir(dir, { recursive: true });
  const requested = /^[a-z0-9-]+$/i.test(name ?? "") ? name : null;
  let slug = requested ?? randomSlug();
  for (let attempt = 0; attempt < 50 && await pathExists(path.join(dir, `${slug}.md`)); attempt++) {
    slug = randomSlug();
  }
  const relPath = path.posix.join(".changeset", `${slug}.md`);
  const frontmatter = entries.map((e) => `'${e.name}': ${e.bump}`).join("\n");
  const body = description.trim();
  const contents = `---
${frontmatter}
---

${body}
`;
  await promises.writeFile(path.join(dir, `${slug}.md`), contents, "utf8");
  return relPath;
}
async function removeChangeset(repoPath, relPath) {
  const normalized = relPath.split(path.sep).join("/");
  if (!isChangesetFile(normalized)) {
    throw new Error(`Refusing to remove non-changeset path: ${relPath}`);
  }
  await promises.rm(path.join(repoPath, normalized), { force: true });
}
const execFileAsync$3 = promisify(execFile);
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const SESSIONS_TREE_PATH = ".super-review/sessions";
function sessionsDir(repoPath) {
  return path.join(repoPath, ".super-review", "sessions");
}
function sessionPath(repoPath, id) {
  return path.join(sessionsDir(repoPath), `${id}.json`);
}
function toSummary(session2) {
  const { files, steps, ...rest } = session2;
  return { ...rest, paths: (files ?? []).map((f) => f.path), stepCount: steps?.length ?? 0 };
}
async function readSession(file) {
  try {
    const raw = await promises.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function listSessions(repoPath) {
  const dir = sessionsDir(repoPath);
  let entries;
  try {
    entries = await promises.readdir(dir);
  } catch {
    return [];
  }
  const sessions = await Promise.all(
    entries.filter((name) => name.endsWith(".json")).map((name) => readSession(path.join(dir, name)))
  );
  return sessions.filter((s) => s !== null).map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt);
}
async function getSession(repoPath, id) {
  return readSession(sessionPath(repoPath, id));
}
async function listSessionFilesAtRef(repoPath, ref) {
  try {
    const { stdout } = await execFileAsync$3(
      "git",
      ["ls-tree", "--name-only", `${ref}:${SESSIONS_TREE_PATH}`],
      { cwd: repoPath }
    );
    return stdout.split("\n").filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}
async function readSessionAtRef(repoPath, ref, name) {
  try {
    const { stdout } = await execFileAsync$3(
      "git",
      ["show", `${ref}:${SESSIONS_TREE_PATH}/${name}`],
      { cwd: repoPath, maxBuffer: MAX_MANIFEST_BYTES }
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
async function listSessionsAtRef(repoPath, ref) {
  const names = await listSessionFilesAtRef(repoPath, ref);
  const sessions = await Promise.all(names.map((name) => readSessionAtRef(repoPath, ref, name)));
  return sessions.filter((s) => s !== null).map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt);
}
async function getSessionAtRef(repoPath, ref, id) {
  return readSessionAtRef(repoPath, ref, `${id}.json`);
}
async function countSessionsAtRef(repoPath, ref) {
  return (await listSessionFilesAtRef(repoPath, ref)).length;
}
async function deleteSession(repoPath, id) {
  await promises.rm(sessionPath(repoPath, id), { force: true });
}
async function clearSessions(repoPath) {
  await promises.rm(sessionsDir(repoPath), { recursive: true, force: true });
}
async function countSessions(repoPath) {
  try {
    const entries = await promises.readdir(sessionsDir(repoPath));
    return entries.filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}
function watchSessionsDir(repoPath, onChange) {
  const superDir = path.join(repoPath, ".super-review");
  const sessionsName = path.basename(sessionsDir(repoPath));
  let watcher2 = null;
  let debounce2 = null;
  let rearmTimer = null;
  let closed = false;
  const notify = () => {
    if (debounce2) clearTimeout(debounce2);
    debounce2 = setTimeout(onChange, 150);
  };
  const deepestExisting = () => {
    let dir = superDir;
    while (!existsSync(dir)) dir = path.dirname(dir);
    return dir;
  };
  const arm = () => {
    if (closed) return;
    const dir = deepestExisting();
    const watchingSuper = dir === superDir;
    try {
      watcher2 = watch(dir, watchingSuper ? { recursive: true } : void 0, (_event, file) => {
        if (watchingSuper) {
          if (!file || file === sessionsName || file.startsWith(sessionsName + path.sep)) {
            notify();
          }
        } else if (existsSync(superDir)) {
          rearm();
        }
      });
      watcher2.on("error", scheduleRearm);
    } catch {
      scheduleRearm();
    }
  };
  function rearm() {
    if (closed) return;
    try {
      watcher2?.close();
    } catch {
    }
    watcher2 = null;
    arm();
    notify();
  }
  function scheduleRearm() {
    if (closed || rearmTimer) return;
    rearmTimer = setTimeout(() => {
      rearmTimer = null;
      rearm();
    }, 200);
  }
  arm();
  return () => {
    closed = true;
    if (debounce2) clearTimeout(debounce2);
    if (rearmTimer) clearTimeout(rearmTimer);
    try {
      watcher2?.close();
    } catch {
    }
    watcher2 = null;
  };
}
const execFileAsync$2 = promisify(execFile);
const MAX_TASKS_BYTES = 16 * 1024 * 1024;
const TASKS_TREE_PATH = ".super-review/tasks";
function tasksDir(repoPath) {
  return path.join(repoPath, ".super-review", "tasks");
}
function taskFileSlug(branch) {
  const safe = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
  const hash2 = createHash("sha1").update(branch).digest("hex").slice(0, 8);
  return `${safe}-${hash2}`;
}
function tasksPath(repoPath, branch) {
  return path.join(tasksDir(repoPath), `${taskFileSlug(branch)}.json`);
}
function byOrder(a, b) {
  return a.order - b.order;
}
async function readTaskList(file) {
  try {
    const raw = await promises.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeTaskList(repoPath, list) {
  const dir = tasksDir(repoPath);
  await promises.mkdir(dir, { recursive: true });
  await promises.writeFile(tasksPath(repoPath, list.branch), JSON.stringify(list, null, 2), "utf8");
}
async function getTaskList(repoPath, branch) {
  return readTaskList(tasksPath(repoPath, branch));
}
async function listTasks(repoPath, branch) {
  const list = await getTaskList(repoPath, branch);
  return (list?.tasks ?? []).slice().sort(byOrder);
}
async function loadList(repoPath, branch, now) {
  return await getTaskList(repoPath, branch) ?? { branch, tasks: [], updatedAt: now };
}
async function addTask(repoPath, branch, input, now = Date.now()) {
  const list = await loadList(repoPath, branch, now);
  const siblings = list.tasks.filter((t) => (t.parentId ?? null) === (input.parentId ?? null));
  const maxOrder = siblings.reduce((m, t) => Math.max(m, t.order), -1);
  const task = {
    id: randomUUID(),
    title: input.title,
    notes: input.notes,
    ...input.parentId ? { parentId: input.parentId } : {},
    done: false,
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actor
  };
  list.tasks.push(task);
  list.updatedAt = now;
  await writeTaskList(repoPath, list);
  return task;
}
async function updateTask(repoPath, branch, id, patch, now = Date.now()) {
  const list = await getTaskList(repoPath, branch);
  const task = list?.tasks.find((t) => t.id === id);
  if (!list || !task) return null;
  if (patch.title !== void 0) task.title = patch.title;
  if (patch.notes !== void 0) task.notes = patch.notes;
  if (patch.order !== void 0) task.order = patch.order;
  if (patch.onHold !== void 0) {
    if (patch.onHold) task.onHold = true;
    else delete task.onHold;
  }
  task.updatedAt = now;
  list.updatedAt = now;
  await writeTaskList(repoPath, list);
  return task;
}
async function setTaskDone(repoPath, branch, id, done, actor, now = Date.now()) {
  const list = await getTaskList(repoPath, branch);
  const task = list?.tasks.find((t) => t.id === id);
  if (!list || !task) return null;
  task.done = done;
  if (done) {
    task.doneBy = actor;
    task.doneAt = now;
  } else {
    delete task.doneBy;
    delete task.doneAt;
  }
  task.updatedAt = now;
  list.updatedAt = now;
  await writeTaskList(repoPath, list);
  return task;
}
async function removeTask(repoPath, branch, id, now = Date.now()) {
  const list = await getTaskList(repoPath, branch);
  if (!list) return;
  const doomed = /* @__PURE__ */ new Set([id]);
  for (let added = true; added; ) {
    added = false;
    for (const t of list.tasks) {
      if (t.parentId && doomed.has(t.parentId) && !doomed.has(t.id)) {
        doomed.add(t.id);
        added = true;
      }
    }
  }
  const next = list.tasks.filter((t) => !doomed.has(t.id));
  if (next.length === list.tasks.length) return;
  list.tasks = next;
  list.updatedAt = now;
  await writeTaskList(repoPath, list);
}
async function reorderTasks(repoPath, branch, ids, now = Date.now()) {
  const list = await getTaskList(repoPath, branch);
  if (!list) return;
  const rank = new Map(ids.map((id, i) => [id, i]));
  const ordered = list.tasks.slice().sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  ordered.forEach((t, i) => t.order = i);
  list.updatedAt = now;
  await writeTaskList(repoPath, list);
}
async function clearTasks(repoPath, branch) {
  await promises.rm(tasksPath(repoPath, branch), { force: true });
}
async function listTasksAtRef(repoPath, branch, ref) {
  try {
    const { stdout } = await execFileAsync$2(
      "git",
      ["show", `${ref}:${TASKS_TREE_PATH}/${taskFileSlug(branch)}.json`],
      { cwd: repoPath, maxBuffer: MAX_TASKS_BYTES }
    );
    const list = JSON.parse(stdout);
    return (list.tasks ?? []).slice().sort(byOrder);
  } catch {
    return [];
  }
}
function watchTasksDir(repoPath, onChange) {
  const superDir = path.join(repoPath, ".super-review");
  const tasksName = path.basename(tasksDir(repoPath));
  let watcher2 = null;
  let debounce2 = null;
  let rearmTimer = null;
  let closed = false;
  const notify = () => {
    if (debounce2) clearTimeout(debounce2);
    debounce2 = setTimeout(onChange, 150);
  };
  const deepestExisting = () => {
    let dir = superDir;
    while (!existsSync(dir)) dir = path.dirname(dir);
    return dir;
  };
  const arm = () => {
    if (closed) return;
    const dir = deepestExisting();
    const watchingSuper = dir === superDir;
    try {
      watcher2 = watch(dir, watchingSuper ? { recursive: true } : void 0, (_event, file) => {
        if (watchingSuper) {
          if (!file || file === tasksName || file.startsWith(tasksName + path.sep)) {
            notify();
          }
        } else if (existsSync(superDir)) {
          rearm();
        }
      });
      watcher2.on("error", scheduleRearm);
    } catch {
      scheduleRearm();
    }
  };
  function rearm() {
    if (closed) return;
    try {
      watcher2?.close();
    } catch {
    }
    watcher2 = null;
    arm();
    notify();
  }
  function scheduleRearm() {
    if (closed || rearmTimer) return;
    rearmTimer = setTimeout(() => {
      rearmTimer = null;
      rearm();
    }, 200);
  }
  arm();
  return () => {
    closed = true;
    if (debounce2) clearTimeout(debounce2);
    if (rearmTimer) clearTimeout(rearmTimer);
    try {
      watcher2?.close();
    } catch {
    }
    watcher2 = null;
  };
}
const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  // Absolute, resolved path of the repo this comment belongs to.
  repo: text("repo").notNull(),
  contextKey: text("context_key").notNull(),
  path: text("path").notNull(),
  side: text("side").$type().notNull(),
  startLine: integer("start_line").notNull(),
  endLine: integer("end_line").notNull(),
  body: text("body").notNull(),
  author: text("author", { mode: "json" }).$type().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  // Thread root id when this row is a reply (see LocalComment.inReplyTo). Null for
  // top-level comments. Added after the initial schema, so existing databases get
  // it via the ALTER in COMMENTS_MIGRATIONS below.
  inReplyTo: text("in_reply_to"),
  resolvedAt: integer("resolved_at"),
  resolvedBy: text("resolved_by", { mode: "json" }).$type(),
  resolvedSessionId: text("resolved_session_id")
});
const CREATE_COMMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS comments (
	id TEXT PRIMARY KEY,
	repo TEXT NOT NULL,
	context_key TEXT NOT NULL,
	path TEXT NOT NULL,
	side TEXT NOT NULL,
	start_line INTEGER NOT NULL,
	end_line INTEGER NOT NULL,
	body TEXT NOT NULL,
	author TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	in_reply_to TEXT,
	resolved_at INTEGER,
	resolved_by TEXT,
	resolved_session_id TEXT
);
CREATE INDEX IF NOT EXISTS comments_repo_context ON comments (repo, context_key);
`;
const COMMENTS_MIGRATIONS = ["ALTER TABLE comments ADD COLUMN in_reply_to TEXT;"];
function appDir() {
  return path.join(homedir(), ".super-review");
}
function appDbPath() {
  return path.join(appDir(), "comments.db");
}
function repoKey(repoPath) {
  return path.resolve(repoPath);
}
let handle = null;
function getHandle() {
  if (!handle) {
    mkdirSync(appDir(), { recursive: true });
    const client2 = createClient({ url: `file:${appDbPath().replace(/\\/g, "/")}` });
    const db2 = drizzle(client2);
    const ready = client2.executeMultiple(CREATE_COMMENTS_TABLE).then(
      () => Promise.all(COMMENTS_MIGRATIONS.map((sql2) => client2.execute(sql2).catch(() => void 0)))
    ).then(() => void 0);
    handle = { client: client2, db: db2, ready };
  }
  return handle;
}
async function getDb() {
  const h = getHandle();
  await h.ready;
  return h.db;
}
function rowToComment(r) {
  return {
    id: r.id,
    contextKey: r.contextKey,
    path: r.path,
    side: r.side,
    startLine: r.startLine,
    endLine: r.endLine,
    body: r.body,
    author: r.author,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...r.inReplyTo != null ? { inReplyTo: r.inReplyTo } : {},
    ...r.resolvedAt != null ? { resolvedAt: r.resolvedAt } : {},
    ...r.resolvedBy != null ? { resolvedBy: r.resolvedBy } : {},
    ...r.resolvedSessionId != null ? { resolvedSessionId: r.resolvedSessionId } : {}
  };
}
async function listComments(repoPath) {
  const db2 = await getDb();
  const rows = await db2.select().from(comments).where(eq(comments.repo, repoKey(repoPath))).orderBy(desc(comments.updatedAt));
  return rows.map(rowToComment);
}
function branchHeadSuffix(contextKey) {
  if (!contextKey.startsWith("branch:")) return null;
  const sep = contextKey.indexOf("..");
  return sep === -1 ? null : contextKey.slice(sep);
}
async function listCommentsForContext(repoPath, contextKey) {
  const headSuffix = branchHeadSuffix(contextKey);
  if (headSuffix !== null) {
    const all = await listComments(repoPath);
    return all.filter(
      (c) => c.contextKey.startsWith("branch:") && c.contextKey.endsWith(headSuffix)
    );
  }
  const db2 = await getDb();
  const rows = await db2.select().from(comments).where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.contextKey, contextKey))).orderBy(desc(comments.updatedAt));
  return rows.map(rowToComment);
}
async function getComment(repoPath, id) {
  const db2 = await getDb();
  const rows = await db2.select().from(comments).where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id))).limit(1);
  return rows[0] ? rowToComment(rows[0]) : null;
}
function createComment(input) {
  const now = Date.now();
  return {
    id: randomUUID(),
    contextKey: input.contextKey,
    path: input.path,
    side: input.side,
    startLine: input.startLine,
    endLine: input.endLine,
    body: input.body,
    author: input.author,
    ...input.inReplyTo != null ? { inReplyTo: input.inReplyTo } : {},
    createdAt: now,
    updatedAt: now
  };
}
async function writeComment(repoPath, comment) {
  const db2 = await getDb();
  const values = {
    id: comment.id,
    repo: repoKey(repoPath),
    contextKey: comment.contextKey,
    path: comment.path,
    side: comment.side,
    startLine: comment.startLine,
    endLine: comment.endLine,
    body: comment.body,
    author: comment.author,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    inReplyTo: comment.inReplyTo ?? null,
    resolvedAt: comment.resolvedAt ?? null,
    resolvedBy: comment.resolvedBy ?? null,
    resolvedSessionId: comment.resolvedSessionId ?? null
  };
  await db2.insert(comments).values(values).onConflictDoUpdate({ target: comments.id, set: values });
}
async function addComment(repoPath, input) {
  const comment = createComment(input);
  await writeComment(repoPath, comment);
  return comment;
}
async function editComment(repoPath, id, body) {
  const existing = await getComment(repoPath, id);
  if (!existing) return null;
  const db2 = await getDb();
  const now = Date.now();
  await db2.update(comments).set({ body, updatedAt: now }).where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id)));
  return { ...existing, body, updatedAt: now };
}
async function deleteComment(repoPath, id) {
  const db2 = await getDb();
  await db2.delete(comments).where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id)));
}
async function resolveComment(repoPath, id, resolver, sessionId) {
  const existing = await getComment(repoPath, id);
  if (!existing) return null;
  const db2 = await getDb();
  const now = Date.now();
  await db2.update(comments).set({
    resolvedAt: now,
    resolvedBy: resolver,
    resolvedSessionId: sessionId ?? null,
    updatedAt: now
  }).where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id)));
  return {
    ...existing,
    resolvedAt: now,
    resolvedBy: resolver,
    ...sessionId ? { resolvedSessionId: sessionId } : {},
    updatedAt: now
  };
}
async function unresolveComment(repoPath, id) {
  const existing = await getComment(repoPath, id);
  if (!existing) return null;
  const db2 = await getDb();
  const now = Date.now();
  await db2.update(comments).set({ resolvedAt: null, resolvedBy: null, resolvedSessionId: null, updatedAt: now }).where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id)));
  const { resolvedAt: _a, resolvedBy: _b, resolvedSessionId: _c, ...rest } = existing;
  return { ...rest, updatedAt: now };
}
function watchCommentsDir(_repoPath, onChange) {
  const dir = appDir();
  let watcher2 = null;
  let debounce2 = null;
  let rearmTimer = null;
  let closed = false;
  const notify = () => {
    if (debounce2) clearTimeout(debounce2);
    debounce2 = setTimeout(onChange, 150);
  };
  const deepestExisting = () => {
    let d = dir;
    while (!existsSync(d)) d = path.dirname(d);
    return d;
  };
  const arm = () => {
    if (closed) return;
    const target = deepestExisting();
    const watchingApp = target === dir;
    try {
      watcher2 = watch(target, (_event, file) => {
        if (watchingApp) {
          if (!file || path.basename(file).startsWith("comments.db")) notify();
        } else if (existsSync(dir)) {
          rearm();
        }
      });
      watcher2.on("error", scheduleRearm);
    } catch {
      scheduleRearm();
    }
  };
  function rearm() {
    if (closed) return;
    try {
      watcher2?.close();
    } catch {
    }
    watcher2 = null;
    arm();
    notify();
  }
  function scheduleRearm() {
    if (closed || rearmTimer) return;
    rearmTimer = setTimeout(() => {
      rearmTimer = null;
      rearm();
    }, 200);
  }
  arm();
  return () => {
    closed = true;
    if (debounce2) clearTimeout(debounce2);
    if (rearmTimer) clearTimeout(rearmTimer);
    try {
      watcher2?.close();
    } catch {
    }
    watcher2 = null;
  };
}
const EDITORS = {
  cursor: {
    cli: "cursor",
    macFallbacks: [
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      `${process.env.HOME}/Applications/Cursor.app/Contents/Resources/app/bin/cursor`
    ]
  },
  vscode: {
    cli: "code",
    macFallbacks: [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      `${process.env.HOME}/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`
    ]
  },
  zed: {
    cli: "zed",
    macFallbacks: ["/Applications/Zed.app/Contents/MacOS/cli"]
  },
  // `xed` opens a file/folder in Xcode but ships with the Command Line Tools, so
  // it's present even without Xcode. Gate on the app bundle to detect Xcode itself.
  xcode: {
    cli: "xed",
    macFallbacks: [],
    macAppBundle: "/Applications/Xcode.app"
  },
  // Full Visual Studio is Windows-only; `devenv` is its CLI. No macOS bundle
  // exists, so on macOS this stays undetected (shown as "Not installed").
  visualstudio: {
    cli: "devenv",
    macFallbacks: []
  }
};
async function which$1(cmd) {
  return await new Promise((resolve) => {
    const finder = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe") : "which";
    const child = spawn(finder, [cmd], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });
    let out = "";
    child.stdout.on("data", (b) => out += String(b));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const exe = lines.find((l) => /\.exe$/i.test(l));
      const cmd2 = lines.find((l) => /\.(cmd|bat)$/i.test(l));
      const withExt = lines.find((l) => path.extname(l) !== "");
      resolve(exe || cmd2 || withExt || lines[0] || null);
    });
    child.on("error", () => resolve(null));
  });
}
async function exists(p) {
  try {
    await promises.access(p);
    return true;
  } catch {
    return false;
  }
}
function winFallbacks(editor) {
  const local = process.env.LOCALAPPDATA;
  const pf = process.env.ProgramFiles;
  const out = [];
  const add = (...parts) => {
    if (parts.every((p) => typeof p === "string" && p.length > 0)) {
      out.push(path.join(...parts));
    }
  };
  switch (editor) {
    case "vscode":
      add(local, "Programs", "Microsoft VS Code", "Code.exe");
      add(pf, "Microsoft VS Code", "Code.exe");
      add(local, "Programs", "Microsoft VS Code", "bin", "code.cmd");
      add(pf, "Microsoft VS Code", "bin", "code.cmd");
      break;
    case "cursor":
      add(local, "Programs", "cursor", "Cursor.exe");
      add(local, "Programs", "Cursor", "Cursor.exe");
      add(local, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd");
      add(local, "Programs", "Cursor", "resources", "app", "bin", "cursor.cmd");
      break;
    case "zed":
      add(local, "Programs", "Zed", "Zed.exe");
      add(local, "Programs", "zed", "Zed.exe");
      break;
  }
  return out;
}
async function normalizeWindowsEditorBin(bin) {
  if (process.platform !== "win32") return bin;
  if (/\.exe$/i.test(bin) && await exists(bin)) return bin;
  const ext = path.extname(bin);
  const base = path.basename(bin, ext).toLowerCase();
  const dir = path.dirname(bin);
  let appDir2 = path.basename(dir).toLowerCase() === "bin" ? path.dirname(dir) : dir;
  if (base === "cursor") {
    if (path.basename(appDir2).toLowerCase() === "app") {
      appDir2 = path.dirname(path.dirname(appDir2));
    }
  }
  const candidates = [];
  if (base === "code") {
    candidates.push(path.join(appDir2, "Code.exe"), path.join(dir, "code.cmd"));
  } else if (base === "cursor") {
    candidates.push(path.join(appDir2, "Cursor.exe"), path.join(dir, "cursor.cmd"));
  } else if (base === "zed") {
    candidates.push(path.join(appDir2, "Zed.exe"));
  }
  if (ext === "") {
    candidates.push(`${bin}.exe`, `${bin}.cmd`, `${bin}.bat`);
  } else if (/\.(cmd|bat)$/i.test(ext)) {
    candidates.push(bin);
  }
  for (const c of candidates) {
    if (await exists(c)) return c;
  }
  return await exists(bin) ? bin : null;
}
async function resolveViaVswhere() {
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  if (!await exists(vswhere)) return null;
  return await new Promise((resolve) => {
    const child = spawn(
      vswhere,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.CoreEditor",
        "-property",
        "productPath"
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
    );
    let out = "";
    child.stdout.on("data", (b) => out += String(b));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const line = out.split(/\r?\n/)[0]?.trim();
      resolve(line || null);
    });
    child.on("error", () => resolve(null));
  });
}
async function resolveVisualStudio() {
  if (process.platform !== "win32") {
    return which$1(EDITORS.visualstudio.cli);
  }
  const onPath = await which$1(EDITORS.visualstudio.cli);
  if (onPath) return onPath;
  const fromVswhere = await resolveViaVswhere();
  if (fromVswhere && await exists(fromVswhere)) return fromVswhere;
  const years = ["2025", "2022", "2019"];
  const editions = ["Community", "Professional", "Enterprise"];
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(
    (r) => typeof r === "string" && r.length > 0
  );
  for (const root of roots) {
    for (const year of years) {
      for (const edition of editions) {
        const candidate = path.join(
          root,
          "Microsoft Visual Studio",
          year,
          edition,
          "Common7",
          "IDE",
          "devenv.exe"
        );
        if (await exists(candidate)) return candidate;
      }
    }
  }
  return null;
}
async function resolveBinary(editor) {
  if (editor === "visualstudio") return resolveVisualStudio();
  const def = EDITORS[editor];
  if (def.macAppBundle && process.platform === "darwin") {
    if (!await exists(def.macAppBundle)) return null;
  }
  if (process.platform === "win32") {
    for (const p of winFallbacks(editor)) {
      if (/\.exe$/i.test(p) && await exists(p)) return p;
    }
    const onPath2 = await which$1(def.cli);
    if (onPath2) {
      const normalized = await normalizeWindowsEditorBin(onPath2);
      if (normalized) return normalized;
    }
    for (const p of winFallbacks(editor)) {
      if (await exists(p)) {
        const normalized = await normalizeWindowsEditorBin(p);
        if (normalized) return normalized;
      }
    }
    return null;
  }
  const onPath = await which$1(def.cli);
  if (onPath) return onPath;
  if (process.platform === "darwin") {
    for (const p of def.macFallbacks) {
      if (await exists(p)) return p;
    }
  }
  return null;
}
async function detectEditors() {
  const [cursor, vscode, zed, xcode, visualstudio] = await Promise.all([
    resolveBinary("cursor"),
    resolveBinary("vscode"),
    resolveBinary("zed"),
    resolveBinary("xcode"),
    resolveBinary("visualstudio")
  ]);
  return {
    cursor: cursor != null,
    vscode: vscode != null,
    zed: zed != null,
    xcode: xcode != null,
    visualstudio: visualstudio != null
  };
}
function editorArgs(editor, target, line) {
  if (line == null || !Number.isFinite(line) || line < 1) return [target];
  switch (editor) {
    case "cursor":
    case "vscode":
      return ["-g", `${target}:${line}`];
    case "zed":
      return [`${target}:${line}`];
    case "xcode":
      return ["--line", String(line), target];
    case "visualstudio":
      return [target];
  }
}
function spawnDetached(bin, args, cwd) {
  return new Promise((resolve) => {
    const opts = {
      detached: true,
      stdio: "ignore",
      cwd,
      windowsHide: true
    };
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
      opts.shell = true;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const child = spawn(bin, args, opts);
      child.on("error", (err) => {
        finish({ ok: false, error: err.message });
      });
      child.unref();
      setImmediate(() => finish({ ok: true }));
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
async function openInEditor(editor, target, line) {
  const bin = await resolveBinary(editor);
  if (!bin) {
    return {
      ok: false,
      error: editor === "visualstudio" ? "Visual Studio was not found. Install Visual Studio or add devenv to PATH." : `${editor} CLI not found. Install the shell command from the editor's command palette, or reinstall the editor.`
    };
  }
  const cwd = path.dirname(target);
  return spawnDetached(bin, editorArgs(editor, target, line), cwd);
}
const TERMINALS = {
  terminal: {
    macApps: ["Terminal"],
    macAppPaths: [
      "/System/Applications/Utilities/Terminal.app",
      "/Applications/Utilities/Terminal.app"
    ]
  },
  iterm: {
    macApps: ["iTerm", "iTerm2"],
    macAppPaths: ["/Applications/iTerm.app"]
  },
  warp: {
    macApps: ["Warp"],
    macAppPaths: ["/Applications/Warp.app"]
  },
  ghostty: {
    macApps: ["Ghostty"],
    macAppPaths: ["/Applications/Ghostty.app"]
  },
  cmd: { winExe: "cmd.exe" },
  powershell: { winExe: "powershell.exe" }
};
async function isTerminalInstalled(terminal) {
  const def = TERMINALS[terminal];
  if (process.platform === "darwin") {
    for (const p of def.macAppPaths ?? []) {
      if (await exists(p)) return true;
    }
    return false;
  }
  if (process.platform === "win32") {
    if (!def.winExe) return false;
    return await which$1(def.winExe) != null;
  }
  return false;
}
async function detectTerminals() {
  const kinds = Object.keys(TERMINALS);
  const entries = await Promise.all(
    kinds.map(async (k) => [k, await isTerminalInstalled(k)])
  );
  return Object.fromEntries(entries);
}
async function openInTerminal(terminal, target) {
  if (!await isTerminalInstalled(terminal)) {
    return { ok: false, error: `${terminal} is not installed.` };
  }
  try {
    if (process.platform === "darwin") {
      const appName = TERMINALS[terminal].macApps?.[0];
      if (!appName) {
        return { ok: false, error: `${terminal} is not supported on macOS.` };
      }
      return spawnDetached("open", ["-a", appName, target]);
    }
    if (process.platform === "win32") {
      const exe = TERMINALS[terminal].winExe;
      if (!exe) {
        return { ok: false, error: `${terminal} is not supported on Windows.` };
      }
      const args = terminal === "powershell" ? ["/c", "start", "", exe, "-NoExit"] : ["/c", "start", "", exe];
      return spawnDetached("cmd.exe", args, target);
    }
    return {
      ok: false,
      error: "Opening in a terminal is only supported on macOS and Windows."
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
const REGISTRY = "https://registry.npmjs.org";
const TTL_MS = 60 * 60 * 1e3;
const FETCH_TIMEOUT_MS = 1e4;
const cache$5 = /* @__PURE__ */ new Map();
const inflight$1 = /* @__PURE__ */ new Map();
function normalizeRepositoryUrl(repo) {
  const raw = typeof repo === "string" ? repo : repo?.url;
  if (!raw) return void 0;
  let url = raw.trim();
  url = url.replace(/^git\+/, "").replace(/\.git$/, "");
  const scp = url.match(/^git@([^:]+):(.+)$/);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  if (url.startsWith("git://")) url = "https://" + url.slice("git://".length);
  if (url.startsWith("ssh://git@")) url = "https://" + url.slice("ssh://git@".length);
  if (url.startsWith("http://")) url = "https://" + url.slice("http://".length);
  if (!url.startsWith("https://")) return void 0;
  return url;
}
function trimDoc(doc) {
  const latestVersion = doc["dist-tags"]?.latest;
  let deprecations;
  if (doc.versions) {
    for (const [version, manifest] of Object.entries(doc.versions)) {
      if (typeof manifest?.deprecated === "string" && manifest.deprecated.length > 0) {
        (deprecations ??= {})[version] = manifest.deprecated;
      }
    }
  }
  const license = typeof doc.license === "string" ? doc.license : doc.license?.type || void 0;
  const author = typeof doc.author === "string" ? doc.author : doc.author?.name || void 0;
  return {
    name: doc.name ?? "",
    description: doc.description,
    latestVersion,
    homepage: doc.homepage,
    repositoryUrl: normalizeRepositoryUrl(doc.repository),
    license,
    author,
    keywords: Array.isArray(doc.keywords) ? doc.keywords.slice(0, 12) : void 0,
    // `time` is just ISO strings — small even for packages with many releases,
    // and the version card needs arbitrary versions, so keep the whole map.
    time: doc.time ?? {},
    deprecations
  };
}
const NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
async function fetchInfo(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const encoded = name.split("/").map((part) => encodeURIComponent(part)).join("/");
    const res = await fetch(`${REGISTRY}/${encoded}`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "super-review (https://github.com/ieedan/super-review)"
      }
    });
    if (res.status === 404) {
      return { ok: false, error: `Package "${name}" not found on npm.` };
    }
    if (!res.ok) {
      return { ok: false, error: `npm registry returned ${res.status}.` };
    }
    const doc = await res.json();
    return { ok: true, info: trimDoc(doc) };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Timed out reaching the npm registry." };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach the npm registry: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}
async function getNpmPackageInfo(name) {
  const trimmed = name.trim();
  if (!NAME_RE.test(trimmed)) {
    return { ok: false, error: `"${name}" is not a valid npm package name.` };
  }
  const cached2 = cache$5.get(trimmed);
  if (cached2 && Date.now() - cached2.at < TTL_MS) return cached2.result;
  const existing = inflight$1.get(trimmed);
  if (existing) return existing;
  const promise = fetchInfo(trimmed).then((result) => {
    const cacheable = result.ok || /not found/.test(result.error);
    if (cacheable) cache$5.set(trimmed, { at: Date.now(), result });
    return result;
  }).finally(() => {
    inflight$1.delete(trimmed);
  });
  inflight$1.set(trimmed, promise);
  return promise;
}
const DEFAULT_HIDDEN_DIFF_PATTERNS = [
  ".super-review/sessions/*",
  ".super-review/tasks/*",
  // JS / TS
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  // Rust
  "Cargo.lock",
  // PHP
  "composer.lock",
  // Ruby
  "Gemfile.lock",
  // Python
  "poetry.lock",
  "pdm.lock",
  "Pipfile.lock",
  "uv.lock",
  // Go
  "go.sum",
  // Nix
  "flake.lock",
  // .NET
  "packages.lock.json",
  // Elixir
  "mix.lock",
  // Dart / Flutter
  "pubspec.lock",
  // CocoaPods
  "Podfile.lock",
  // Gradle
  "gradle.lockfile"
];
const HOTKEY_ACTIONS = [
  "searchFilesPalette",
  "searchFilesSidebar",
  "openRepoPicker",
  "openBranchPicker",
  "toggleSidebar",
  "toggleTasksSidebar",
  "toggleCommentsSidebar",
  "openConversationSidebar",
  "openSettings",
  "markSeenNext"
];
const DEFAULT_HOTKEYS = {
  // Not mod+P: the native Repository menu owns that for Push, and Electron
  // dispatches menu accelerators before the renderer ever sees the keydown.
  searchFilesPalette: { key: "k", mod: true },
  searchFilesSidebar: { key: "/" },
  openRepoPicker: { key: "r", shift: true },
  openBranchPicker: { key: "b", shift: true },
  toggleSidebar: { key: "b", mod: true },
  toggleTasksSidebar: { key: "t", mod: true },
  toggleCommentsSidebar: { key: "l", mod: true },
  openConversationSidebar: { key: "l", mod: true, shift: true },
  openSettings: { key: ",", mod: true },
  markSeenNext: { key: "Enter", mod: true }
};
function normalizeHotkeyKey(key) {
  return key.length === 1 ? key.toLowerCase() : key;
}
function hotkeysEqual(a, b) {
  return a.key === b.key && Boolean(a.mod) === Boolean(b.mod) && Boolean(a.shift) === Boolean(b.shift) && Boolean(a.alt) === Boolean(b.alt);
}
const MENU_ACCELERATORS = {
  push: { label: "Push", accelerator: "CmdOrCtrl+P" },
  pull: { label: "Pull", accelerator: "Shift+CmdOrCtrl+P" },
  fetch: { label: "Fetch", accelerator: "Shift+CmdOrCtrl+T" },
  removeRepo: { label: "Remove repository", accelerator: "CmdOrCtrl+Backspace" },
  viewOnGithub: { label: "View on GitHub", accelerator: "Shift+CmdOrCtrl+G" },
  openInTerminal: { label: "Open in terminal", accelerator: "Control+`" },
  showInFinder: { label: "Reveal in file manager", accelerator: "Shift+CmdOrCtrl+F" },
  openInEditor: { label: "Open in editor", accelerator: "Shift+CmdOrCtrl+A" },
  createIssue: { label: "Create issue on GitHub", accelerator: "CmdOrCtrl+I" },
  newBranch: { label: "New branch", accelerator: "Shift+CmdOrCtrl+N" },
  updateFromDefault: { label: "Update from default branch", accelerator: "Shift+CmdOrCtrl+U" },
  deleteBranch: { label: "Delete branch", accelerator: "Shift+CmdOrCtrl+D" },
  discardAll: { label: "Discard all changes", accelerator: "Shift+CmdOrCtrl+Backspace" },
  previewPR: { label: "Preview pull request", accelerator: "Alt+CmdOrCtrl+P" },
  sendFeedback: { label: "Send feedback", accelerator: "Shift+CmdOrCtrl+/" }
};
const ROLE_ACCELERATORS = [
  { label: "Close window", accelerator: "CmdOrCtrl+W" },
  { label: "Minimize", accelerator: "CmdOrCtrl+M" },
  { label: "Undo", accelerator: "CmdOrCtrl+Z" },
  { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z" },
  { label: "Cut", accelerator: "CmdOrCtrl+X" },
  { label: "Copy", accelerator: "CmdOrCtrl+C" },
  { label: "Paste", accelerator: "CmdOrCtrl+V" },
  { label: "Select all", accelerator: "CmdOrCtrl+A" },
  { label: "Reload", accelerator: "CmdOrCtrl+R" },
  { label: "Force reload", accelerator: "Shift+CmdOrCtrl+R" },
  { label: "Toggle developer tools", accelerator: "Alt+CmdOrCtrl+I" },
  { label: "Actual size", accelerator: "CmdOrCtrl+0" }
];
const RESERVED_ACCELERATORS = [
  ...Object.values(MENU_ACCELERATORS),
  ...ROLE_ACCELERATORS
];
function parseAccelerator(accelerator) {
  const parts = accelerator.split("+");
  const key = parts.pop();
  if (!key) return null;
  const hk = { key: normalizeHotkeyKey(key) };
  for (const part of parts) {
    if (part === "CmdOrCtrl" || part === "Cmd" || part === "Command" || part === "Control") {
      hk.mod = true;
    } else if (part === "Shift") {
      hk.shift = true;
    } else if (part === "Alt" || part === "Option") {
      hk.alt = true;
    } else {
      return null;
    }
  }
  return hk;
}
function reservedHotkeyLabel(hk) {
  for (const reserved of RESERVED_ACCELERATORS) {
    const parsed = parseAccelerator(reserved.accelerator);
    if (parsed && hotkeysEqual(parsed, hk)) return reserved.label;
  }
  return null;
}
const STAT_METRICS = [
  "filesReviewed",
  "locReviewed",
  "prsMerged",
  "branchesCreated",
  "commitsAuthored",
  "filesCommitted",
  "linesCommitted",
  "sessionsReviewed",
  "commentsWritten"
];
const DEFAULT_STATS_WIDGETS = [
  "commitsAuthored",
  "prsMerged",
  "filesReviewed"
];
function dayKey(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function emptyDaily() {
  const daily = {};
  for (const m of STAT_METRICS) daily[m] = {};
  return daily;
}
function emptyStats() {
  return { daily: emptyDaily(), firstUsedAt: null };
}
function emptyStoredStats() {
  return { ...emptyStats(), reviewedSigs: [], reviewedSessionIds: [] };
}
function addToDay(daily, key, n) {
  daily[key] = (daily[key] ?? 0) + n;
}
function projectStats(s) {
  return { daily: s.daily, firstUsedAt: s.firstUsedAt };
}
const DEFAULT_SETTINGS = {
  viewMode: "split",
  diffLayout: "scroll",
  theme: "dark",
  diffTheme: "pierre",
  accent: "super",
  externalEditor: null,
  externalTerminal: null,
  commitMessageHarness: null,
  commitMessagePrompt: null,
  commitMessageModels: {},
  changesetPrompt: null,
  unstagedFileListLayout: "tree",
  branchFileListLayout: "tree",
  showFileIcons: true,
  openFileOnArrowNav: true,
  codeFont: "system",
  uiFont: "system",
  indentGuides: true,
  maxDiffLines: 1500,
  hiddenDiffPatterns: DEFAULT_HIDDEN_DIFF_PATTERNS,
  customFileIcons: [],
  animations: "accents",
  prMergedBehavior: "prompt",
  autoRemoveMergedBranch: false,
  unmarkSeenOnChange: true,
  hotkeys: DEFAULT_HOTKEYS,
  windowWidth: WINDOW_BOUNDS.defaultWidth,
  windowHeight: WINDOW_BOUNDS.defaultHeight,
  startMaximized: false,
  recentRepoCount: 5,
  changesetsEnabled: true,
  signCommits: true,
  automaticUpdates: true,
  headerItems: DEFAULT_HEADER_ITEMS,
  fileHeaderItems: DEFAULT_FILE_HEADER_ITEMS,
  sidebarTabs: DEFAULT_SIDEBAR_TABS,
  sidebarControls: DEFAULT_SIDEBAR_CONTROLS,
  statsWidgets: [...DEFAULT_STATS_WIDGETS],
  emptyViewItems: DEFAULT_EMPTY_VIEW_ITEMS
};
const SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const editorEnum = z.enum(["cursor", "vscode", "zed", "xcode", "visualstudio"]);
const terminalEnum = z.enum(["terminal", "iterm", "warp", "ghostty", "cmd", "powershell"]);
const commitMessageHarnessEnum = z.enum(["claude-code", "cursor", "codex", "opencode", "copilot"]);
const statMetricEnum = z.enum([...STAT_METRICS]);
const boolMap = z.record(z.string(), z.boolean());
const FIELD_SCHEMAS = {
  viewMode: z.enum(["split", "unified"]),
  diffLayout: z.enum(["scroll", "single"]),
  theme: z.enum(["light", "dark"]),
  diffTheme: z.string(),
  accent: z.enum(["super", "mono"]),
  externalEditor: editorEnum.nullable(),
  externalTerminal: terminalEnum.nullable(),
  commitMessageHarness: commitMessageHarnessEnum.nullable(),
  commitMessagePrompt: z.string().nullable(),
  commitMessageModels: z.record(z.string(), z.string()),
  changesetPrompt: z.string().nullable(),
  unstagedFileListLayout: z.enum(["tree", "list"]),
  branchFileListLayout: z.enum(["tree", "list"]),
  showFileIcons: z.boolean(),
  openFileOnArrowNav: z.boolean(),
  codeFont: z.string(),
  uiFont: z.string(),
  indentGuides: z.boolean(),
  maxDiffLines: z.number().min(0),
  hiddenDiffPatterns: z.array(z.string()),
  customFileIcons: z.array(z.object({ pattern: z.string(), source: z.string() })),
  animations: z.enum(["none", "accents", "all"]),
  prMergedBehavior: z.enum(["prompt", "switch", "nothing"]),
  autoRemoveMergedBranch: z.boolean(),
  unmarkSeenOnChange: z.boolean(),
  hotkeys: z.record(
    z.string(),
    z.object({
      key: z.string(),
      mod: z.boolean().optional(),
      shift: z.boolean().optional(),
      alt: z.boolean().optional()
    })
  ),
  windowWidth: z.number().min(1),
  windowHeight: z.number().min(1),
  startMaximized: z.boolean(),
  recentRepoCount: z.number().min(0),
  changesetsEnabled: z.boolean(),
  signCommits: z.boolean(),
  automaticUpdates: z.boolean(),
  headerItems: boolMap,
  fileHeaderItems: boolMap,
  sidebarTabs: boolMap,
  sidebarControls: boolMap,
  statsWidgets: z.array(statMetricEnum),
  emptyViewItems: boolMap
};
function validate(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const defaults2 = DEFAULT_SETTINGS;
  const values = {};
  const reset = [];
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const fallback = structuredClone(defaults2[key]);
    const rawVal = obj[key];
    if (rawVal === void 0) {
      values[key] = fallback;
      continue;
    }
    const schema = FIELD_SCHEMAS[key];
    const res = schema.safeParse(rawVal);
    if (res.success) {
      values[key] = res.data;
    } else {
      reset.push(key);
      values[key] = fallback;
    }
  }
  return { values, reset };
}
function settingsFilePath() {
  return path.join(app.getPath("userData"), "settings.json");
}
function serialize(values) {
  const ordered = {};
  for (const key of Object.keys(DEFAULT_SETTINGS))
    ordered[key] = values[key];
  return JSON.stringify(ordered, null, 2) + "\n";
}
function currentSettingsText() {
  return serialize(getSettings());
}
let cache$4 = null;
let lastWritten = null;
function loadSyncFromDisk() {
  let text2;
  try {
    text2 = readFileSync(settingsFilePath(), "utf8");
  } catch {
    return { values: structuredClone(DEFAULT_SETTINGS), reset: [], malformed: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch {
    return { values: structuredClone(DEFAULT_SETTINGS), reset: [], malformed: true };
  }
  const { values, reset } = validate(parsed);
  return { values, reset, malformed: false };
}
function getSettings() {
  if (!cache$4) cache$4 = loadSyncFromDisk().values;
  return cache$4;
}
function persistSync(values) {
  const text2 = serialize(values);
  const target = settingsFilePath();
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, text2, "utf8");
  renameSync(tmp, target);
  lastWritten = text2;
  cache$4 = values;
}
function initSettingsFile(seed) {
  let existed = true;
  try {
    readFileSync(settingsFilePath(), "utf8");
  } catch {
    existed = false;
  }
  if (!existed) {
    const values = validate(seed).values;
    persistSync(values);
    return { values, reset: [], malformed: false };
  }
  const result = loadSyncFromDisk();
  cache$4 = result.values;
  return result;
}
function mergeSettingsFile(patch) {
  const next = { ...getSettings(), ...patch };
  persistSync(next);
  return next;
}
function replaceSettingsFile(raw) {
  const { values, reset } = validate(raw);
  persistSync(values);
  return { values, reset };
}
let watcher = null;
let debounce = null;
function watchSettingsFile(onExternalChange) {
  if (watcher) return;
  const dir = app.getPath("userData");
  const name = "settings.json";
  try {
    watcher = watch(dir, (_event, filename) => {
      if (filename && path.basename(filename.toString()) !== name) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        let text2;
        try {
          text2 = await readFile(settingsFilePath(), "utf8");
        } catch {
          return;
        }
        if (text2 === lastWritten) return;
        let parsed;
        try {
          parsed = { ...validate(JSON.parse(text2)), malformed: false };
        } catch {
          parsed = { values: getSettings(), reset: [], malformed: true };
        }
        if (!parsed.malformed) cache$4 = parsed.values;
        onExternalChange(parsed);
      }, 150);
    });
  } catch {
  }
}
const MENU_BAR_HEIGHT = 30;
function titleBarOverlayFor(theme) {
  if (theme === "light") {
    return { color: "#00000000", symbolColor: "#1a1a1a", height: MENU_BAR_HEIGHT };
  }
  return { color: "#00000000", symbolColor: "#c4c4c4", height: MENU_BAR_HEIGHT };
}
function syncTitleBarOverlay(theme) {
  if (process.platform !== "win32") return;
  const overlay = titleBarOverlayFor(theme);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setTitleBarOverlay(overlay);
  }
}
function targetWindow(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  if (win && !win.isDestroyed()) return win;
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}
function performWindowChromeAction(sender, action) {
  const win = targetWindow(sender);
  const wc = win?.webContents;
  switch (action) {
    case "undo":
      wc?.undo();
      return;
    case "redo":
      wc?.redo();
      return;
    case "cut":
      wc?.cut();
      return;
    case "copy":
      wc?.copy();
      return;
    case "paste":
      wc?.paste();
      return;
    case "selectAll":
      wc?.selectAll();
      return;
    case "reload":
      wc?.reload();
      return;
    case "forceReload":
      wc?.reloadIgnoringCache();
      return;
    case "toggleDevTools":
      wc?.toggleDevTools();
      return;
    case "resetZoom":
      wc?.setZoomLevel(0);
      return;
    case "zoomIn":
      if (wc) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
      return;
    case "zoomOut":
      if (wc) wc.setZoomLevel(wc.getZoomLevel() - 0.5);
      return;
    case "toggleFullscreen":
      if (win) win.setFullScreen(!win.isFullScreen());
      return;
    case "minimize":
      win?.minimize();
      return;
    case "maximize":
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return;
    case "close":
      win?.close();
      return;
    case "quit":
      app.quit();
      return;
  }
}
function setupWindowChromeIpc() {
  ipcMain.handle("window:perform", (e, action) => {
    performWindowChromeAction(e.sender, action);
  });
}
function normalizeSeenEntry(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((p) => [p, ""]));
  return { ...raw };
}
function parseDiffSig(sig) {
  if (!sig) return null;
  const body = sig.startsWith("oid:") ? sig.slice(4) : sig;
  const i = body.indexOf("..");
  if (i === -1) return null;
  return { base: body.slice(0, i), dst: body.slice(i + 2) };
}
function diffChainCovers(byCtx, contextKey, path2, target, includeContextKey = false) {
  const adj = /* @__PURE__ */ new Map();
  for (const [otherKey, otherSeen] of Object.entries(byCtx)) {
    if (otherKey === contextKey && !includeContextKey) continue;
    const edge = parseDiffSig(normalizeSeenEntry(otherSeen)[path2]);
    if (!edge) continue;
    const from = adj.get(edge.base) ?? adj.set(edge.base, /* @__PURE__ */ new Set()).get(edge.base);
    from.add(edge.dst);
  }
  const queue = [target.base];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const oid = queue.shift();
    if (oid === target.dst) return true;
    for (const next of adj.get(oid) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return false;
}
function computeRetainedSeen(byCtx, contextKey, fileSigs) {
  const seenHere = normalizeSeenEntry(byCtx[contextKey]);
  const retained = [];
  for (const [path2, newSig] of Object.entries(fileSigs)) {
    const stored = seenHere[path2];
    if (!stored) continue;
    const target = parseDiffSig(newSig);
    if (!target) continue;
    if (stored === newSig) continue;
    if (diffChainCovers(byCtx, contextKey, path2, target, true)) retained.push(path2);
  }
  return retained;
}
function computeInheritedSeen(byCtx, contextKey, alreadyApplied, fileDiffSigs) {
  const seenHere = normalizeSeenEntry(byCtx[contextKey]);
  const applied = [];
  for (const [path2, sig] of Object.entries(fileDiffSigs)) {
    const target = parseDiffSig(sig);
    if (!target) continue;
    if (seenHere[path2]) continue;
    if (alreadyApplied[path2] === sig) continue;
    if (!diffChainCovers(byCtx, contextKey, path2, target)) continue;
    applied.push(path2);
  }
  return applied;
}
const DEFAULT_PREF_STATE = {
  sidebarCollapsed: false,
  commentsSidebarOpen: false,
  commentsSidebarTab: "comments",
  conversationFullscreen: false
};
const defaults = {
  repos: {},
  prefs: { ...DEFAULT_SETTINGS, ...DEFAULT_PREF_STATE },
  seen: {},
  seenInherited: {},
  collapsedFiles: {},
  fileLists: {},
  branchBases: {},
  commitDrafts: {},
  prBranches: {},
  githubAccounts: {},
  activeGithubAccountId: null,
  githubToken: null,
  stats: {},
  commitMessageModels: {},
  license: {
    deviceToken: null,
    deviceTokenEncrypted: false,
    cachedLicenseToken: null,
    lastValidationAt: null,
    lastSeenWallClock: 0,
    fallbackFingerprint: null
  }
};
const store = new Store({ defaults, name: "super-review" });
let cache$3 = null;
function db() {
  if (!cache$3) {
    cache$3 = { ...defaults, ...store.store };
    if (migrateBranchReviewKeys()) flush();
    if (migrateStats()) flush();
  }
  return cache$3;
}
function migrateStats() {
  if (!cache$3) return false;
  let changed = false;
  for (const [id, raw] of Object.entries(cache$3.stats)) {
    const entry = raw;
    if (entry.daily) continue;
    const legacy = entry;
    const firstUsedAt = typeof legacy.firstUsedAt === "number" ? legacy.firstUsedAt : null;
    const seedDay = dayKey(new Date(firstUsedAt ?? Date.now()));
    const migrated = emptyStoredStats();
    migrated.firstUsedAt = firstUsedAt;
    migrated.reviewedSigs = Array.isArray(legacy.reviewedSigs) ? legacy.reviewedSigs : [];
    migrated.reviewedSessionIds = Array.isArray(legacy.reviewedSessionIds) ? legacy.reviewedSessionIds : [];
    const seed = {
      filesReviewed: migrated.reviewedSigs.length,
      locReviewed: typeof legacy.locReviewed === "number" ? legacy.locReviewed : 0,
      prsMerged: typeof legacy.prsMerged === "number" ? legacy.prsMerged : 0,
      branchesCreated: typeof legacy.branchesCreated === "number" ? legacy.branchesCreated : 0,
      commitsAuthored: typeof legacy.commitsAuthored === "number" ? legacy.commitsAuthored : 0,
      // Added after the flat-counter era, so legacy entries have no value here.
      filesCommitted: 0,
      linesCommitted: 0,
      sessionsReviewed: migrated.reviewedSessionIds.length,
      commentsWritten: typeof legacy.commentsWritten === "number" ? legacy.commentsWritten : 0
    };
    for (const m of STAT_METRICS) if (seed[m] > 0) addToDay(migrated.daily[m], seedDay, seed[m]);
    cache$3.stats[id] = migrated;
    changed = true;
  }
  return changed;
}
function migrateBranchReviewKeys() {
  if (!cache$3) return false;
  let changed = false;
  for (const byCtx of Object.values(cache$3.seen)) {
    for (const key of Object.keys(byCtx)) {
      const head = legacyBranchHead(key);
      if (!head) continue;
      const newKey = `branch:${head}`;
      byCtx[newKey] = { ...normalizeSeen(byCtx[key]), ...normalizeSeen(byCtx[newKey]) };
      delete byCtx[key];
      changed = true;
    }
  }
  for (const byCtx of Object.values(cache$3.collapsedFiles)) {
    for (const key of Object.keys(byCtx)) {
      const head = legacyBranchHead(key);
      if (!head) continue;
      const newKey = `branch:${head}`;
      byCtx[newKey] = [.../* @__PURE__ */ new Set([...byCtx[newKey] ?? [], ...byCtx[key]])];
      delete byCtx[key];
      changed = true;
    }
  }
  return changed;
}
function legacyBranchHead(key) {
  if (!key.startsWith("branch:") || !key.includes("..")) return null;
  return key.slice(key.lastIndexOf("..") + 2);
}
function flush() {
  if (pendingFlush) {
    clearTimeout(pendingFlush);
    pendingFlush = null;
  }
  if (cache$3) store.store = cache$3;
}
let pendingFlush = null;
function flushSoon() {
  if (pendingFlush) return;
  pendingFlush = setTimeout(flush, 500);
}
function flushStore() {
  flush();
}
db();
let settingsStartupIssues = (() => {
  const stored = db().prefs;
  const seed = {};
  for (const key of SETTINGS_KEYS) {
    if (key in stored) seed[key] = stored[key];
  }
  const result = initSettingsFile(seed);
  return { malformed: result.malformed, reset: result.reset };
})();
function getSettingsStartupIssues() {
  return settingsStartupIssues;
}
function clearSettingsStartupIssues() {
  settingsStartupIssues = { malformed: false, reset: [] };
}
function upsertRepo(repo) {
  db().repos[repo.id] = repo;
  flush();
}
function listRepos() {
  return Object.values(db().repos).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}
function removeRepo(id) {
  const d = db();
  delete d.repos[id];
  delete d.seen[id];
  delete d.collapsedFiles[id];
  delete d.fileLists[id];
  delete d.branchBases[id];
  delete d.commitDrafts[id];
  delete d.prBranches[id];
  delete d.stats[id];
  if (d.prefs.activeRepoId === id) d.prefs = { ...d.prefs, activeRepoId: void 0 };
  flush();
}
function getRepo(id) {
  return db().repos[id] ?? null;
}
function normalizeRepoPath(p) {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function getRepoByPath(repoPath) {
  const target = normalizeRepoPath(repoPath);
  for (const repo of Object.values(db().repos)) {
    if (normalizeRepoPath(repo.path) === target) return repo;
  }
  return null;
}
function setRepoGithubAccountId(repoId, accountId) {
  const repos = db().repos;
  const repo = repos[repoId];
  if (!repo) return null;
  const next = { ...repo };
  if (accountId) next.githubAccountId = accountId;
  else delete next.githubAccountId;
  repos[repoId] = next;
  flush();
  return next;
}
function setRepoUpstream(repoId, upstream) {
  const repos = db().repos;
  const repo = repos[repoId];
  if (!repo) return null;
  const next = { ...repo };
  if (upstream) {
    next.upstreamOwner = upstream.owner;
    next.upstreamRepo = upstream.repo;
  } else {
    delete next.upstreamOwner;
    delete next.upstreamRepo;
  }
  repos[repoId] = next;
  flush();
  return next;
}
function setRepoFork(repoId, fork, upstream) {
  const repos = db().repos;
  const repo = repos[repoId];
  if (!repo) return null;
  const next = {
    ...repo,
    githubOwner: fork.owner,
    githubRepo: fork.repo,
    remoteUrl: fork.url
  };
  if (upstream) {
    next.upstreamOwner = upstream.owner;
    next.upstreamRepo = upstream.repo;
  } else {
    delete next.upstreamOwner;
    delete next.upstreamRepo;
  }
  repos[repoId] = next;
  flush();
  return next;
}
function setPRBranch(repoId, branch, link) {
  const all = db().prBranches;
  const forRepo = all[repoId] ??= {};
  if (link) forRepo[branch] = link;
  else delete forRepo[branch];
  flush();
}
function getPRBranch(repoId, branch) {
  return db().prBranches[repoId]?.[branch] ?? null;
}
function getPrefs() {
  const merged = { ...defaults.prefs, ...db().prefs, ...getSettings() };
  if (merged.theme !== "light" && merged.theme !== "dark") {
    merged.theme = defaults.prefs.theme;
  }
  merged.hotkeys = { ...defaults.prefs.hotkeys, ...merged.hotkeys };
  for (const action of HOTKEY_ACTIONS) {
    if (reservedHotkeyLabel(merged.hotkeys[action])) {
      merged.hotkeys[action] = defaults.prefs.hotkeys[action];
    }
  }
  merged.headerItems = { ...defaults.prefs.headerItems, ...merged.headerItems };
  merged.fileHeaderItems = { ...defaults.prefs.fileHeaderItems, ...merged.fileHeaderItems };
  merged.sidebarControls = { ...defaults.prefs.sidebarControls, ...merged.sidebarControls };
  merged.emptyViewItems = { ...defaults.prefs.emptyViewItems, ...merged.emptyViewItems };
  return merged;
}
function setPrefs(patch) {
  const settingsPatch = {};
  const statePatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SETTINGS_KEYS.has(key)) settingsPatch[key] = value;
    else statePatch[key] = value;
  }
  if (Object.keys(settingsPatch).length > 0)
    mergeSettingsFile(settingsPatch);
  if (Object.keys(statePatch).length > 0) {
    db().prefs = { ...db().prefs, ...statePatch };
    flush();
  }
  const prefs = getPrefs();
  if ("theme" in patch) syncTitleBarOverlay(prefs.theme);
  return prefs;
}
function replacePrefsSettings(raw) {
  const { reset } = replaceSettingsFile(raw);
  const prefs = getPrefs();
  syncTitleBarOverlay(prefs.theme);
  return { prefs, reset };
}
function resetPrefsSettings() {
  replaceSettingsFile({});
  const prefs = getPrefs();
  syncTitleBarOverlay(prefs.theme);
  return prefs;
}
function normalizeSeen(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((p) => [p, ""]));
  return { ...raw };
}
function getSeen(repoId, contextKey) {
  return Object.keys(normalizeSeen(db().seen[repoId]?.[contextKey]));
}
function getSeenSignatures(repoId, contextKey) {
  return normalizeSeen(db().seen[repoId]?.[contextKey]);
}
function getInheritedSeen(repoId, contextKey, fileDiffSigs) {
  const byCtx = db().seen[repoId];
  if (!byCtx) return [];
  const seenHere = normalizeSeen(byCtx[contextKey]);
  const appliedAll = db().seenInherited[repoId] ??= {};
  const appliedHere = appliedAll[contextKey] ??= {};
  const applied = computeInheritedSeen(byCtx, contextKey, appliedHere, fileDiffSigs);
  for (const path2 of applied) {
    appliedHere[path2] = fileDiffSigs[path2];
    seenHere[path2] = fileDiffSigs[path2];
  }
  if (applied.length > 0) {
    (db().seen[repoId] ??= {})[contextKey] = seenHere;
    const repoCollapsed = db().collapsedFiles[repoId] ??= {};
    const collapsedHere = new Set(repoCollapsed[contextKey] ?? []);
    for (const path2 of applied) collapsedHere.add(path2);
    repoCollapsed[contextKey] = [...collapsedHere];
    flush();
  }
  return applied;
}
function getRetainedSeen(repoId, contextKey, fileDiffSigs) {
  const byCtx = db().seen[repoId];
  if (!byCtx) return [];
  const retained = computeRetainedSeen(byCtx, contextKey, fileDiffSigs);
  if (retained.length === 0) return [];
  const seenHere = normalizeSeen(byCtx[contextKey]);
  for (const path2 of retained) seenHere[path2] = fileDiffSigs[path2];
  (db().seen[repoId] ??= {})[contextKey] = seenHere;
  flush();
  return retained;
}
function setSeen(repoId, contextKey, filePath, seen, sig = "") {
  const all = db().seen;
  const forRepo = all[repoId] ??= {};
  const forCtx = normalizeSeen(forRepo[contextKey]);
  if (seen) forCtx[filePath] = sig;
  else delete forCtx[filePath];
  forRepo[contextKey] = forCtx;
  flush();
}
function clearSeen(repoId, contextKey) {
  const all = db().seen;
  if (all[repoId]) {
    delete all[repoId][contextKey];
    flush();
  }
}
function getCollapsedFiles(repoId, contextKey) {
  return db().collapsedFiles[repoId]?.[contextKey] ?? [];
}
function setFileCollapsed(repoId, contextKey, filePath, collapsed) {
  const all = db().collapsedFiles;
  const forRepo = all[repoId] ??= {};
  const forCtx = new Set(forRepo[contextKey] ?? []);
  if (collapsed) forCtx.add(filePath);
  else forCtx.delete(filePath);
  forRepo[contextKey] = [...forCtx];
  flush();
}
function setFilesCollapsed(repoId, contextKey, filePaths, collapsed) {
  const all = db().collapsedFiles;
  const forRepo = all[repoId] ??= {};
  const forCtx = new Set(forRepo[contextKey] ?? []);
  if (collapsed) for (const p of filePaths) forCtx.add(p);
  else for (const p of filePaths) forCtx.delete(p);
  forRepo[contextKey] = [...forCtx];
  flush();
}
function clearCollapsedFiles(repoId, contextKey) {
  const all = db().collapsedFiles;
  if (all[repoId]) {
    delete all[repoId][contextKey];
    flush();
  }
}
function getCachedFileList(repoId, contextKey) {
  return db().fileLists[repoId]?.[contextKey] ?? [];
}
const MAX_CACHED_CONTEXTS_PER_REPO = 40;
function setCachedFileList(repoId, contextKey, files) {
  const all = db().fileLists;
  const forRepo = all[repoId] ??= {};
  if (files.length) {
    delete forRepo[contextKey];
    forRepo[contextKey] = files;
    const keys = Object.keys(forRepo);
    for (const stale of keys.slice(0, keys.length - MAX_CACHED_CONTEXTS_PER_REPO)) {
      delete forRepo[stale];
    }
  } else {
    delete forRepo[contextKey];
  }
  flushSoon();
}
function getBranchBase(repoId, branch) {
  return db().branchBases[repoId]?.[branch] ?? null;
}
function setBranchBase(repoId, branch, base) {
  const all = db().branchBases;
  const forRepo = all[repoId] ??= {};
  if (base) forRepo[branch] = base;
  else delete forRepo[branch];
  flush();
}
function getCommitDraft(repoId) {
  return db().commitDrafts[repoId] ?? { summary: "", description: "" };
}
function setCommitDraft(repoId, draft) {
  const all = db().commitDrafts;
  if (!draft.summary && !draft.description) {
    delete all[repoId];
  } else {
    all[repoId] = draft;
  }
  flush();
}
function getCachedCommitMessageModels(harness, version) {
  const hit = db().commitMessageModels?.[harness];
  if (!hit || !Array.isArray(hit.models) || hit.models.length === 0) return null;
  if (hit.version !== version) return null;
  return hit;
}
function setCachedCommitMessageModels(harness, models, fetchedAt, version) {
  if (models.length === 0) return;
  const all = db().commitMessageModels ??= {};
  all[harness] = { models, fetchedAt, version };
  flushSoon();
}
function getLegacyGithubToken() {
  return db().githubToken;
}
function clearLegacyGithubToken() {
  db().githubToken = null;
  flush();
}
function listGithubAccounts() {
  return Object.values(db().githubAccounts).sort((a, b) => a.addedAt - b.addedAt);
}
function getGithubAccount(id) {
  return db().githubAccounts[id] ?? null;
}
function getActiveGithubAccountId() {
  return db().activeGithubAccountId;
}
function getActiveGithubAccount() {
  const id = getActiveGithubAccountId();
  if (!id) return null;
  return getGithubAccount(id);
}
function setActiveGithubAccountId(id) {
  db().activeGithubAccountId = id;
  flush();
}
function upsertGithubAccount(account) {
  db().githubAccounts[account.id] = account;
  flush();
}
function setSigningKeyRegistered(id) {
  const acct = db().githubAccounts[id];
  if (!acct) return;
  acct.signingKeyRegistered = true;
  flush();
}
function removeGithubAccount(id) {
  const d = db();
  delete d.githubAccounts[id];
  if (getActiveGithubAccountId() === id) {
    const remaining = Object.keys(d.githubAccounts);
    d.activeGithubAccountId = remaining[0] ?? null;
  }
  for (const repo of Object.values(d.repos)) {
    if (repo.githubAccountId === id) delete repo.githubAccountId;
  }
  flush();
}
function getLicenseSlice() {
  return db().license;
}
function setDeviceToken(raw) {
  const d = db();
  if (raw === null) {
    d.license.deviceToken = null;
    d.license.deviceTokenEncrypted = false;
    flush();
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    d.license.deviceToken = safeStorage.encryptString(raw).toString("base64");
    d.license.deviceTokenEncrypted = true;
  } else {
    d.license.deviceToken = raw;
    d.license.deviceTokenEncrypted = false;
  }
  flush();
}
function getDeviceToken() {
  const { deviceToken, deviceTokenEncrypted } = db().license;
  if (!deviceToken) return null;
  if (!deviceTokenEncrypted) return deviceToken;
  try {
    return safeStorage.decryptString(Buffer.from(deviceToken, "base64"));
  } catch {
    return null;
  }
}
function setCachedLicenseToken(token) {
  db().license.cachedLicenseToken = token;
  flush();
}
function setLastValidation(serverTimeMs) {
  db().license.lastValidationAt = serverTimeMs;
  flush();
}
function bumpWallClock(nowMs) {
  db().license.lastSeenWallClock = nowMs;
  flush();
}
function getFallbackFingerprint() {
  return db().license.fallbackFingerprint;
}
function setFallbackFingerprint(value) {
  db().license.fallbackFingerprint = value;
  flush();
}
function ensureStats(repoId) {
  const d = db();
  let s = d.stats[repoId];
  if (!s) {
    s = emptyStoredStats();
    d.stats[repoId] = s;
  }
  for (const m of STAT_METRICS) if (!s.daily[m]) s.daily[m] = {};
  return s;
}
function markUsed(s) {
  if (s.firstUsedAt === null) s.firstUsedAt = Date.now();
}
function recordToday(s, metric, n) {
  addToDay(s.daily[metric], dayKey(/* @__PURE__ */ new Date()), n);
  markUsed(s);
  flush();
}
function getStats(repoId) {
  const s = db().stats[repoId];
  return s ? projectStats(s) : emptyStats();
}
function getAllStats() {
  const out = {};
  for (const [id, s] of Object.entries(db().stats)) out[id] = projectStats(s);
  return out;
}
function recordFileReviewed(repoId, sig, loc) {
  if (!sig) return;
  const s = ensureStats(repoId);
  if (s.reviewedSigs.includes(sig)) return;
  s.reviewedSigs.push(sig);
  const today = dayKey(/* @__PURE__ */ new Date());
  addToDay(s.daily.filesReviewed, today, 1);
  addToDay(s.daily.locReviewed, today, Math.max(0, loc));
  markUsed(s);
  flush();
}
function recordSessionReviewed(repoId, sessionId) {
  if (!sessionId) return;
  const s = ensureStats(repoId);
  if (s.reviewedSessionIds.includes(sessionId)) return;
  s.reviewedSessionIds.push(sessionId);
  recordToday(s, "sessionsReviewed", 1);
}
function bumpStat(repoId, key) {
  recordToday(ensureStats(repoId), key, 1);
}
function addStat(repoId, key, n) {
  if (n <= 0) return;
  recordToday(ensureStats(repoId), key, n);
}
const execFileAsync$1 = promisify(execFile);
function signingDir() {
  return path.join(app.getPath("userData"), "signing");
}
function keyPathFor(accountId) {
  return path.join(signingDir(), `${accountId}_ed25519`);
}
async function ensureSigningKey(accountId, login) {
  const keyPath = keyPathFor(accountId);
  try {
    await promises.access(keyPath);
    return keyPath;
  } catch {
  }
  try {
    await promises.mkdir(signingDir(), { recursive: true, mode: 448 });
    await execFileAsync$1("ssh-keygen", [
      "-t",
      "ed25519",
      "-f",
      keyPath,
      "-N",
      "",
      // empty passphrase
      "-C",
      `super-review ${login}`,
      "-q"
    ]);
    await promises.chmod(keyPath, 384).catch(() => {
    });
    return keyPath;
  } catch {
    return null;
  }
}
async function readSigningPublicKey(accountId) {
  try {
    return (await promises.readFile(`${keyPathFor(accountId)}.pub`, "utf8")).trim();
  } catch {
    return null;
  }
}
async function removeSigningKey(accountId) {
  const keyPath = keyPathFor(accountId);
  await promises.rm(keyPath, { force: true }).catch(() => {
  });
  await promises.rm(`${keyPath}.pub`, { force: true }).catch(() => {
  });
}
const CLIENT_ID = process.env.SUPER_REVIEW_GH_CLIENT_ID ?? "178c6fc778ccc68e1d6a";
const SCOPES = ["repo", "read:user", "workflow", "write:ssh_signing_key"];
const SIGNING_SCOPE = "write:ssh_signing_key";
let pending$1 = null;
let lastStatus$1 = { state: "pending" };
let migrationDone = false;
function publicAccount(a) {
  const { token: _token, ...rest } = a;
  return rest;
}
async function fetchAccountForToken(token) {
  const o = new Octokit({ auth: token });
  const res = await o.users.getAuthenticated();
  const u = res.data;
  const scopes = res.headers["x-oauth-scopes"] ?? "";
  return {
    id: String(u.id),
    login: u.login,
    name: u.name ?? void 0,
    avatarUrl: u.avatar_url ?? void 0,
    addedAt: Date.now(),
    token,
    scopes
  };
}
function hasSigningScope(account) {
  const granted = account.scopes?.split(",").map((s) => s.trim());
  return granted?.includes(SIGNING_SCOPE) ?? false;
}
async function migrateLegacyTokenOnce() {
  if (migrationDone) return;
  migrationDone = true;
  const legacy = getLegacyGithubToken();
  if (!legacy) return;
  if (listGithubAccounts().length > 0) {
    clearLegacyGithubToken();
    return;
  }
  try {
    const account = await fetchAccountForToken(legacy);
    upsertGithubAccount(account);
    setActiveGithubAccountId(account.id);
  } catch {
  } finally {
    clearLegacyGithubToken();
  }
}
async function listAccounts() {
  await migrateLegacyTokenOnce();
  return listGithubAccounts().map(publicAccount);
}
async function getActiveAccount() {
  await migrateLegacyTokenOnce();
  const a = getActiveGithubAccount();
  return a ? publicAccount(a) : null;
}
async function setActiveAccount(id) {
  const a = getGithubAccount(id);
  if (!a) return null;
  setActiveGithubAccountId(id);
  return publicAccount(a);
}
async function removeAccount(id) {
  removeGithubAccount(id);
  await removeSigningKey(id);
}
async function startDeviceFlow() {
  if (pending$1) pending$1.cancel();
  lastStatus$1 = { state: "pending" };
  let openedResolve = null;
  const openedPromise = new Promise((resolve) => {
    openedResolve = resolve;
  });
  let cancelled = false;
  pending$1 = {
    cancel: () => {
      cancelled = true;
    }
  };
  const auth = createOAuthDeviceAuth({
    clientType: "oauth-app",
    clientId: CLIENT_ID,
    scopes: SCOPES,
    onVerification(verification) {
      openedResolve?.({
        userCode: verification.user_code,
        verificationUri: verification.verification_uri,
        expiresInSec: verification.expires_in,
        intervalSec: verification.interval
      });
      void shell.openExternal(verification.verification_uri);
    }
  });
  void (async () => {
    try {
      const result = await auth({ type: "oauth" });
      if (cancelled) return;
      const account = await fetchAccountForToken(result.token);
      upsertGithubAccount(account);
      setActiveGithubAccountId(account.id);
      clearAuthError(account.id);
      lastStatus$1 = { state: "success", account: publicAccount(account) };
    } catch (err) {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      lastStatus$1 = { state: "error", message };
    } finally {
      pending$1 = null;
    }
  })();
  return openedPromise;
}
function pollDeviceFlow() {
  return lastStatus$1;
}
function cancelDeviceFlow() {
  if (pending$1) {
    pending$1.cancel();
    pending$1 = null;
  }
  lastStatus$1 = { state: "pending" };
}
function resolveAccount(accountId) {
  const pinned = accountId ? getGithubAccount(accountId) : null;
  const account = pinned ?? getActiveGithubAccount();
  if (!account) throw new Error("Not authenticated with GitHub. Sign in first.");
  return account;
}
const authErrors = /* @__PURE__ */ new Map();
let authErrorsListener = null;
function onAuthErrorsChanged(listener) {
  authErrorsListener = listener;
}
function getAuthErrors() {
  return [...authErrors.values()];
}
function authFailureReason(err) {
  const status = err.status;
  if (status === 401) return "revoked";
  if (status === 403) {
    const headers = err.response?.headers;
    if (headers?.["x-github-sso"]) return "sso";
  }
  return null;
}
function noteRequestFailed(account, err) {
  const reason = authFailureReason(err);
  if (!reason) return;
  if (authErrors.get(account.id)?.reason === reason) return;
  authErrors.set(account.id, { accountId: account.id, login: account.login, reason });
  authErrorsListener?.(getAuthErrors());
}
function noteRequestSucceeded(accountId) {
  if (authErrors.get(accountId)?.reason === "scope") return;
  if (authErrors.delete(accountId)) authErrorsListener?.(getAuthErrors());
}
function clearAuthError(accountId) {
  if (authErrors.delete(accountId)) authErrorsListener?.(getAuthErrors());
}
function flagAccountsMissingSigningScope() {
  if (!getPrefs().signCommits) return;
  let changed = false;
  for (const account of listGithubAccounts()) {
    if (hasSigningScope(account)) continue;
    if (authErrors.has(account.id)) continue;
    authErrors.set(account.id, { accountId: account.id, login: account.login, reason: "scope" });
    changed = true;
  }
  if (changed) authErrorsListener?.(getAuthErrors());
}
async function validateAccounts() {
  await migrateLegacyTokenOnce();
  await Promise.all(
    listGithubAccounts().map(
      (account) => octokit(account).users.getAuthenticated().catch(() => {
      })
    )
  );
  flagAccountsMissingSigningScope();
  return getAuthErrors();
}
function octokit(account) {
  const o = new Octokit({ auth: account.token });
  o.hook.after("request", () => noteRequestSucceeded(account.id));
  o.hook.error("request", (err) => {
    noteRequestFailed(account, err);
    throw err;
  });
  return o;
}
const AUTHOR_RESOLVE_CONCURRENCY = 6;
async function mapPooled(items, limit, task) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
async function resolveCommitAuthors(owner, repo, candidates, accountId) {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  const out = {};
  await mapPooled(candidates, AUTHOR_RESOLVE_CONCURRENCY, async ({ email, shas }) => {
    for (const sha of shas.slice(0, 5)) {
      try {
        const res = await o.repos.getCommit({ owner, repo, ref: sha });
        const author = res.data.author;
        if (author?.login) {
          out[email.trim().toLowerCase()] = {
            login: author.login,
            avatarUrl: author.avatar_url
          };
          return;
        }
      } catch {
      }
    }
  });
  return out;
}
const releaseNotesCache = /* @__PURE__ */ new Map();
const RELEASE_NOTES_TTL_MS = 60 * 60 * 1e3;
function parseGithubRepo(repositoryUrl) {
  let url;
  try {
    url = new URL(repositoryUrl);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}
function releaseNotesOctokit() {
  const account = getActiveGithubAccount();
  return account ? new Octokit({ auth: account.token }) : new Octokit();
}
async function getReleaseNotes(repositoryUrl, packageName, version) {
  const parsed = parseGithubRepo(repositoryUrl);
  if (!parsed || !version) return { ok: true, release: null };
  const { owner, repo } = parsed;
  const cacheKey = `${packageName}@${version}`;
  const cached2 = releaseNotesCache.get(cacheKey);
  if (cached2 && Date.now() - cached2.at < RELEASE_NOTES_TTL_MS) return cached2.result;
  const o = releaseNotesOctokit();
  const tags = [`v${version}`, version, `${packageName}@${version}`];
  try {
    let result = { ok: true, release: null };
    for (const tag of tags) {
      try {
        const { data } = await o.repos.getReleaseByTag({ owner, repo, tag });
        result = { ok: true, release: mapRelease(data) };
        break;
      } catch (err) {
        if (err.status === 404) continue;
        throw err;
      }
    }
    releaseNotesCache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not load release notes: ${message}` };
  }
}
function mapRelease(data) {
  return {
    tag: data.tag_name,
    name: data.name ?? void 0,
    body: data.body ?? void 0,
    htmlUrl: data.html_url,
    publishedAt: data.published_at ?? void 0
  };
}
const RANGE_MAX = 20;
function parseSemver(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/.exec(version.trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : [] };
}
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  const n = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < n; i++) {
    const ai = a.pre[i];
    const bi = b.pre[i];
    if (ai === void 0) return -1;
    if (bi === void 0) return 1;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const d = +ai - +bi;
      if (d !== 0) return d;
    } else if (an)
      return -1;
    else if (bn) return 1;
    else if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}
function versionFromTag(tag, packageName, preferNameAt) {
  if (tag.startsWith(`${packageName}@`)) return tag.slice(packageName.length + 1);
  if (preferNameAt) return null;
  if (/^v\d/.test(tag)) return tag.slice(1);
  if (/^\d/.test(tag)) return tag;
  return null;
}
const releaseNotesRangeCache = /* @__PURE__ */ new Map();
async function getReleaseNotesRange(repositoryUrl, packageName, fromVersion, toVersion) {
  const parsed = parseGithubRepo(repositoryUrl);
  const from = parseSemver(fromVersion);
  const to = parseSemver(toVersion);
  if (!parsed || !from || !to) return { ok: true, releases: [], truncated: false };
  const cmp = compareSemver(from, to);
  if (cmp === 0) return { ok: true, releases: [], truncated: false };
  const lo = cmp < 0 ? from : to;
  const hi = cmp < 0 ? to : from;
  const { owner, repo } = parsed;
  const cacheKey = `${packageName}:${fromVersion}..${toVersion}`;
  const cached2 = releaseNotesRangeCache.get(cacheKey);
  if (cached2 && Date.now() - cached2.at < RELEASE_NOTES_TTL_MS) return cached2.result;
  const o = releaseNotesOctokit();
  try {
    const { data } = await o.repos.listReleases({ owner, repo, per_page: 100 });
    const usesNameAt = data.some((r) => r.tag_name.startsWith(`${packageName}@`));
    const inRange = [];
    let reachedLo = false;
    for (const r of data) {
      if (r.draft) continue;
      const versionStr = versionFromTag(r.tag_name, packageName, usesNameAt);
      if (!versionStr) continue;
      const v = parseSemver(versionStr);
      if (!v) continue;
      if (compareSemver(v, lo) <= 0) {
        reachedLo = true;
        continue;
      }
      if (compareSemver(v, hi) > 0) continue;
      inRange.push({ v, release: mapRelease(r) });
    }
    inRange.sort((x, y) => compareSemver(y.v, x.v));
    const incomplete = data.length >= 100 && !reachedLo;
    const releases = inRange.slice(0, RANGE_MAX).map((x) => x.release);
    const truncated = incomplete || inRange.length > RANGE_MAX;
    const result = { ok: true, releases, truncated };
    releaseNotesRangeCache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not load release notes: ${message}` };
  }
}
function registerGitCredentials() {
  setGitCredentialProvider((remoteUrl, repoPath) => {
    let host;
    try {
      host = new URL(remoteUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
    if (host !== "github.com") return null;
    const account = resolveAccountForRepoPath(repoPath);
    if (!account?.token) return null;
    return { username: "x-access-token", password: account.token };
  });
}
function resolveAccountForRepoPath(repoPath) {
  if (repoPath) {
    const pinnedId = getRepoByPath(repoPath)?.githubAccountId;
    if (pinnedId) {
      const pinned = getGithubAccount(pinnedId);
      if (pinned) return pinned;
    }
  }
  return getActiveGithubAccount();
}
function resolveCommitIdentity(accountId) {
  const pinned = accountId ? getGithubAccount(accountId) : null;
  const account = pinned ?? getActiveGithubAccount();
  if (!account) return null;
  return {
    name: account.name ?? account.login,
    email: `${account.id}+${account.login}@users.noreply.github.com`
  };
}
async function resolveCommitSigning(accountId) {
  if (!getPrefs().signCommits) return null;
  if (!await checkSshSigningSupported()) return null;
  const pinned = accountId ? getGithubAccount(accountId) : null;
  const account = pinned ?? getActiveGithubAccount();
  if (!account) return null;
  const keyPath = await ensureSigningKey(account.id, account.login);
  if (!keyPath) return null;
  void ensureSigningKeyRegistered(account);
  return { keyPath };
}
async function ensureSigningKeyRegistered(account) {
  if (account.signingKeyRegistered) return;
  if (!hasSigningScope(account)) return;
  const publicKey = await readSigningPublicKey(account.id);
  if (!publicKey) return;
  try {
    await octokit(account).request("POST /user/ssh_signing_keys", {
      title: `Super Review (${os.hostname()})`,
      key: publicKey
    });
    setSigningKeyRegistered(account.id);
  } catch (err) {
    if (err.status === 422) {
      setSigningKeyRegistered(account.id);
      return;
    }
  }
}
async function listOrganizations(accountId) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.orgs.listForAuthenticatedUser({ per_page: 100 });
  return res.data.map((org) => ({ login: org.login, avatarUrl: org.avatar_url ?? void 0 }));
}
async function findRemoteRepo(name, accountId, owner) {
  const account = resolveAccount(accountId);
  const o = octokit(account);
  const ns = owner || account.login;
  try {
    const res = await o.repos.get({ owner: ns, repo: name });
    return {
      owner: res.data.owner?.login ?? ns,
      name: res.data.name,
      htmlUrl: res.data.html_url
    };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}
async function createRemoteRepo(opts) {
  const account = resolveAccount(opts.accountId);
  const o = octokit(account);
  const params = {
    name: opts.name,
    description: opts.description,
    private: opts.private,
    auto_init: false
  };
  const shape = (d) => ({
    cloneUrl: d.clone_url,
    sshUrl: d.ssh_url,
    htmlUrl: d.html_url,
    owner: d.owner?.login ?? ""
  });
  try {
    const res = opts.org ? await o.repos.createInOrg({ org: opts.org, ...params }) : await o.repos.createForAuthenticatedUser(params);
    return shape(res.data);
  } catch (err) {
    const status = err.status;
    if (status !== 422) throw err;
    const owner = opts.org ?? account.login;
    const got = await o.repos.get({ owner, repo: opts.name });
    return shape(got.data);
  }
}
const PR_PAGE_SIZE = 30;
function toPRSummary(pr) {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user?.login ?? "unknown",
    authorAvatarUrl: pr.user?.avatar_url ?? "",
    authorAssociation: pr.author_association ?? void 0,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    url: pr.html_url,
    draft: pr.draft ?? false,
    updatedAt: pr.updated_at,
    createdAt: pr.created_at,
    state: pr.state,
    merged: pr.merged_at != null,
    headRepoCloneUrl: pr.head.repo?.clone_url ?? void 0,
    headRepoOwner: pr.head.repo?.owner?.login ?? void 0,
    headRepoName: pr.head.repo?.name ?? void 0,
    maintainerCanModify: pr.maintainer_can_modify ?? void 0,
    repoOwner: pr.base.repo?.owner?.login ?? void 0,
    repoName: pr.base.repo?.name ?? void 0,
    // Present only on single-PR (pulls.get) responses — absent on list rows.
    // Keep null (GitHub still computing) distinct from undefined (not fetched).
    mergeable: pr.mergeable === void 0 ? void 0 : pr.mergeable,
    mergeableState: pr.mergeable_state ?? void 0
  };
}
async function canPushToPR(args, accountId) {
  const o = octokit(resolveAccount(accountId));
  let definitive = true;
  if (args.headOwner && args.headRepo) {
    try {
      const head = await o.repos.get({
        owner: args.headOwner,
        repo: args.headRepo
      });
      if (head.data.permissions?.push) return true;
    } catch (err) {
      if (err.status !== 404) definitive = false;
    }
  }
  try {
    let canModify = args.maintainerCanModify;
    if (canModify === void 0) {
      const pr = await o.pulls.get({
        owner: args.baseOwner,
        repo: args.baseRepo,
        pull_number: args.prNumber
      });
      canModify = pr.data.maintainer_can_modify ?? false;
    }
    if (canModify) {
      const base = await o.repos.get({
        owner: args.baseOwner,
        repo: args.baseRepo
      });
      if (base.data.permissions?.push) return true;
    }
  } catch (err) {
    if (err.status !== 404) definitive = false;
  }
  return definitive ? false : null;
}
async function listPullRequests(owner, repo, accountId, page = 1) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.pulls.list({
    owner,
    repo,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: PR_PAGE_SIZE,
    page
  });
  return res.data.map(toPRSummary);
}
async function listMentionableUsers(owner, repo, accountId) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.issues.listAssignees({ owner, repo, per_page: 100 });
  return res.data.map((u) => ({ login: u.login, avatarUrl: u.avatar_url }));
}
function toIssueReference(d) {
  const isPR = d.pull_request != null;
  return {
    number: d.number,
    title: d.title,
    state: d.state === "closed" ? "closed" : "open",
    isPullRequest: isPR,
    draft: isPR ? d.draft ?? false : void 0,
    merged: isPR ? d.pull_request?.merged_at != null : void 0
  };
}
async function listIssueReferences(owner, repo, accountId, query) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.issues.listForRepo({
    owner,
    repo,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: 50
  });
  const items = res.data.map(toIssueReference);
  const num = query && /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;
  if (num != null && Number.isSafeInteger(num) && !items.some((i) => i.number === num)) {
    try {
      const one = await o.issues.get({ owner, repo, issue_number: num });
      items.unshift(toIssueReference(one.data));
    } catch {
    }
  }
  return items;
}
async function getUpstream(owner, repo, accountId) {
  const o = octokit(resolveAccount(accountId));
  try {
    const res = await o.repos.get({ owner, repo });
    const parent = res.data.parent;
    if (res.data.fork && parent?.owner?.login && parent.name) {
      return { owner: parent.owner.login, repo: parent.name };
    }
    return null;
  } catch {
    return null;
  }
}
async function canPushToRepo(owner, repo, accountId) {
  const o = octokit(resolveAccount(accountId));
  try {
    const res = await o.repos.get({ owner, repo });
    return res.data.permissions?.push === true;
  } catch (err) {
    return err.status === 404 ? false : null;
  }
}
async function createFork(owner, repo, accountId) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.repos.createFork({ owner, repo });
  const fork = { owner: res.data.owner?.login ?? "", repo: res.data.name };
  if (!fork.owner) throw new Error("Fork created but its owner could not be resolved.");
  for (let i = 0; i < 10; i++) {
    try {
      await o.repos.get({ owner: fork.owner, repo: fork.repo });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1e3));
    }
  }
  return fork;
}
async function getPRBase(owner, repo, prNumber, accountId) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.pulls.get({ owner, repo, pull_number: prNumber });
  return { baseRef: res.data.base.ref, headRef: res.data.head.ref };
}
async function getPRSummary(owner, repo, prNumber, accountId) {
  const o = octokit(resolveAccount(accountId));
  try {
    const res = await o.pulls.get({ owner, repo, pull_number: prNumber });
    return toPRSummary(res.data);
  } catch {
    return null;
  }
}
function checkRunState(status, conclusion) {
  if (status !== "completed") return "pending";
  switch (conclusion) {
    case "failure":
    case "cancelled":
    case "timed_out":
    case "action_required":
      return "failure";
    default:
      return "success";
  }
}
function rollupChecks(checks) {
  if (checks.length === 0) return "none";
  if (checks.some((c) => c.state === "failure")) return "failure";
  if (checks.some((c) => c.state === "pending")) return "pending";
  return "success";
}
function deploymentState(s) {
  switch (s) {
    case "ACTIVE":
    case "SUCCESS":
      return "success";
    case "ERROR":
    case "FAILURE":
      return "failure";
    case "IN_PROGRESS":
    case "QUEUED":
    case "PENDING":
    case "WAITING":
      return "pending";
    default:
      return null;
  }
}
async function getDeployments(o, owner, repo, ref) {
  const query = `
    query ($owner: String!, $repo: String!, $oid: GitObjectID!) {
      repository(owner: $owner, name: $repo) {
        object(oid: $oid) {
          ... on Commit {
            deployments(first: 50, orderBy: { field: CREATED_AT, direction: DESC }) {
              nodes {
                environment
                creator { avatarUrl }
                latestStatus { state environmentUrl logUrl }
              }
            }
          }
        }
      }
    }`;
  const res = await o.graphql(query, { owner, repo, oid: ref });
  const nodes = res?.repository?.object?.deployments?.nodes ?? [];
  const byEnv = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    const env = n.environment ?? "deployment";
    if (byEnv.has(env)) continue;
    const url = n.latestStatus?.environmentUrl || n.latestStatus?.logUrl;
    if (!url) continue;
    byEnv.set(env, {
      environment: env,
      state: deploymentState(n.latestStatus?.state),
      url,
      // The creating app's avatar is the hosting provider's logo.
      avatarUrl: n.creator?.avatarUrl ?? null
    });
  }
  return [...byEnv.values()];
}
async function getChecks(owner, repo, ref, accountId) {
  const o = octokit(resolveAccount(accountId));
  const [runs, combined, deployments] = await Promise.all([
    o.checks.listForRef({ owner, repo, ref, per_page: 100 }),
    o.repos.getCombinedStatusForRef({ owner, repo, ref }).catch(() => null),
    // Deployments are best-effort; a failure here must not sink the checks.
    getDeployments(o, owner, repo, ref).catch(() => [])
  ]);
  const checks = [];
  for (const run of runs.data.check_runs) {
    const started = run.started_at ? Date.parse(run.started_at) : NaN;
    const completed = run.completed_at ? Date.parse(run.completed_at) : NaN;
    const durationMs = Number.isFinite(started) && Number.isFinite(completed) ? Math.max(0, completed - started) : null;
    checks.push({
      name: run.name,
      state: checkRunState(run.status, run.conclusion),
      durationMs,
      avatarUrl: run.app?.owner?.avatar_url ?? null,
      // `details_url` is the specific job/run page (what GitHub links the row
      // to); `html_url` is the check-run itself. Prefer the former.
      url: run.details_url ?? run.html_url ?? null
    });
  }
  if (combined) {
    for (const s of combined.data.statuses) {
      const state = s.state === "success" ? "success" : s.state === "pending" ? "pending" : "failure";
      checks.push({
        name: s.context,
        state,
        durationMs: null,
        avatarUrl: s.avatar_url ?? null,
        url: s.target_url ?? null
      });
    }
  }
  return { state: rollupChecks(checks), checks, deployments };
}
function mapReviewComment(c, prNumber, viewerLogin) {
  return {
    id: c.id,
    prNumber,
    path: c.path,
    body: c.body ?? "",
    bodyHtml: c.body_html ?? void 0,
    author: c.user?.login ?? "unknown",
    authorAvatarUrl: c.user?.avatar_url ?? "",
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    url: c.html_url,
    // `line` is the live anchor (null when outdated); `original_line` is kept
    // separately so we can still render/label an outdated comment. We no longer
    // fall back from one to the other — conflating them would pin an outdated
    // comment onto the wrong current-diff line.
    line: c.line ?? null,
    originalLine: c.original_line ?? null,
    position: c.position ?? null,
    diffHunk: c.diff_hunk ?? void 0,
    // Outdated = the comment had a line anchor (`original_line`) that no longer
    // maps into the current diff, so GitHub nulls the live `line`. We key off
    // `line` rather than `position`: REST keeps `position` populated (it reflects
    // the original diff position) even for outdated comments, whereas `line` goes
    // null — matching GitHub's GraphQL `outdated` flag. Requiring `original_line`
    // excludes genuine file-level comments (no line anchor at all).
    isOutdated: c.line == null && c.original_line != null,
    side: c.side ?? "RIGHT",
    inReplyTo: c.in_reply_to_id ?? void 0,
    canDelete: viewerLogin ? c.user?.login === viewerLogin : false,
    // Thread info lives in GraphQL, not the REST payload — defaulted here and
    // stamped on by listReviewComments. Newly created/replied comments keep
    // these defaults until the next refresh refetches the threads.
    threadId: void 0,
    isResolved: false
  };
}
async function fetchThreadInfoByCommentId(o, owner, repo, prNumber) {
  const query = `
    query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isResolved
              comments(first: 100) {
                nodes { databaseId }
              }
            }
          }
        }
      }
    }`;
  const map = /* @__PURE__ */ new Map();
  let cursor = null;
  for (; ; ) {
    const res = await o.graphql(query, {
      owner,
      repo,
      number: prNumber,
      cursor
    });
    const threads = res?.repository?.pullRequest?.reviewThreads;
    if (!threads) break;
    for (const t of threads.nodes ?? []) {
      for (const c of t.comments?.nodes ?? []) {
        if (c?.databaseId != null) {
          map.set(c.databaseId, { threadId: t.id, isResolved: t.isResolved });
        }
      }
    }
    if (!threads.pageInfo?.hasNextPage) break;
    cursor = threads.pageInfo.endCursor;
  }
  return map;
}
async function listReviewComments(owner, repo, prNumber, accountId) {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  const all = await o.paginate(o.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100
  });
  let threadInfo;
  try {
    threadInfo = await fetchThreadInfoByCommentId(o, owner, repo, prNumber);
  } catch (err) {
    console.error(
      `[github] fetchReviewThreads failed for ${owner}/${repo}#${prNumber}:`,
      err instanceof Error ? err.message : err
    );
    threadInfo = /* @__PURE__ */ new Map();
  }
  return all.map((c) => {
    const mapped = mapReviewComment(c, prNumber, viewer?.login ?? null);
    const info = threadInfo.get(mapped.id);
    if (info) {
      mapped.threadId = info.threadId;
      mapped.isResolved = info.isResolved;
    }
    return mapped;
  });
}
async function setReviewThreadResolved(threadId, resolved, accountId) {
  const o = octokit(resolveAccount(accountId));
  const mutation = resolved ? `mutation ($threadId: ID!) {
         resolveReviewThread(input: { threadId: $threadId }) {
           thread { id isResolved }
         }
       }` : `mutation ($threadId: ID!) {
         unresolveReviewThread(input: { threadId: $threadId }) {
           thread { id isResolved }
         }
       }`;
  const res = await o.graphql(mutation, { threadId });
  const thread = resolved ? res?.resolveReviewThread?.thread : res?.unresolveReviewThread?.thread;
  return { isResolved: thread?.isResolved ?? resolved };
}
async function createReviewComment(owner, repo, input, accountId, commitId) {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  const anchor = commitId ?? (await o.pulls.get({ owner, repo, pull_number: input.prNumber })).data.head.sha;
  try {
    const res = await o.pulls.createReviewComment({
      owner,
      repo,
      pull_number: input.prNumber,
      body: input.body,
      commit_id: anchor,
      path: input.path,
      line: input.line,
      side: input.side
    });
    return mapReviewComment(res.data, input.prNumber, viewer?.login ?? null);
  } catch (err) {
    const status = err.status;
    const errors = err.response?.data?.errors;
    const unresolvableAnchor = errors?.some(
      (e) => e.field?.endsWith(".path") || e.field?.endsWith(".line") || e.field?.endsWith(".commit_id")
    );
    if (status === 422 && unresolvableAnchor) {
      throw new Error(
        `GitHub couldn't place this comment on ${input.path}:${input.line} — that line isn't part of the PR's current diff. Either the PR was updated since you opened it, or your local branch has changes that haven't been pushed to the PR yet. Refresh the PR (or push your branch) and try again.`,
        { cause: err }
      );
    }
    throw err;
  }
}
async function replyReviewComment(owner, repo, prNumber, commentId, body, accountId) {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  const res = await o.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    comment_id: commentId,
    body
  });
  return mapReviewComment(res.data, prNumber, viewer?.login ?? null);
}
async function deleteReviewComment(owner, repo, commentId, accountId) {
  const o = octokit(resolveAccount(accountId));
  await o.pulls.deleteReviewComment({ owner, repo, comment_id: commentId });
}
async function updateReviewComment(owner, repo, commentId, body, accountId) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.pulls.updateReviewComment({ owner, repo, comment_id: commentId, body });
  return res.data.body ?? body;
}
async function findPRForBranch(baseOwner, baseRepo, headOwner, branch, accountId) {
  const account = resolveAccount(accountId);
  console.log(
    `[github] findPRForBranch base=${baseOwner}/${baseRepo} head=${headOwner}:${branch} requestedAccountId=${accountId ?? "(none → app default)"} usingAccount=${account.login} (id=${account.id})`
  );
  const o = octokit(account);
  const res = await o.pulls.list({
    owner: baseOwner,
    repo: baseRepo,
    state: "open",
    head: `${headOwner}:${branch}`,
    per_page: 1
  });
  console.log(
    `[github] findPRForBranch head=${headOwner}:${branch} → ${res.data.length} match(es)` + (res.data[0] ? ` (PR #${res.data[0].number})` : "")
  );
  const pr = res.data[0];
  if (!pr) return null;
  return toPRSummary(pr);
}
function reviewState(state) {
  switch (String(state).toLowerCase()) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes_requested";
    case "commented":
      return "commented";
    case "dismissed":
      return "dismissed";
    default:
      return null;
  }
}
function mapTimelineItem(e, viewerLogin) {
  switch (e.event) {
    case "commented": {
      const author = e.user?.login ?? "unknown";
      return {
        kind: "comment",
        key: `comment-${e.id}`,
        id: e.id,
        author,
        authorAvatarUrl: e.user?.avatar_url ?? "",
        authorAssociation: e.author_association ?? void 0,
        body: e.body ?? "",
        url: e.html_url ?? "",
        createdAt: e.created_at,
        canDelete: viewerLogin ? author === viewerLogin : false
      };
    }
    case "reviewed": {
      const state = reviewState(e.state);
      if (!state) return null;
      if (state === "commented" && !(e.body ?? "").trim()) return null;
      return {
        kind: "review",
        key: `review-${e.id}`,
        id: e.id,
        author: e.user?.login ?? "unknown",
        authorAvatarUrl: e.user?.avatar_url ?? "",
        authorAssociation: e.author_association ?? void 0,
        body: e.body ?? "",
        state,
        url: e.html_url ?? "",
        createdAt: e.submitted_at ?? e.created_at
      };
    }
    case "committed": {
      const sha = e.sha ?? "";
      const lines = (e.message ?? "").split("\n");
      const message = lines[0] ?? "";
      const body = lines.slice(1).join("\n").trim();
      return {
        kind: "commit",
        key: `commit-${sha}`,
        sha,
        shortSha: sha.slice(0, 7),
        message,
        body: body || void 0,
        author: e.author?.name ?? e.committer?.name ?? "unknown",
        verified: e.verification?.verified === true,
        url: e.html_url ?? void 0,
        createdAt: e.author?.date ?? e.committer?.date ?? ""
      };
    }
    // Lighter activity events rendered as a one-line entry. Anything not listed
    // here falls through to `null` and is dropped.
    case "merged":
    case "closed":
    case "reopened":
    case "locked":
    case "unlocked":
    case "head_ref_force_pushed":
    case "head_ref_deleted":
    case "head_ref_restored":
    case "convert_to_draft":
    case "ready_for_review":
    case "labeled":
    case "unlabeled":
    case "renamed":
    case "review_requested":
    case "review_request_removed":
    case "assigned":
    case "unassigned": {
      let detail;
      let labelColor;
      let renamedFrom;
      if (e.event === "labeled" || e.event === "unlabeled") {
        detail = e.label?.name;
        labelColor = e.label?.color ?? void 0;
      } else if (e.event === "renamed") {
        detail = e.rename?.to;
        renamedFrom = e.rename?.from;
      } else if (e.event === "review_requested" || e.event === "review_request_removed")
        detail = e.requested_reviewer?.login ?? e.requested_team?.name;
      else if (e.event === "assigned" || e.event === "unassigned") detail = e.assignee?.login;
      return {
        kind: "event",
        key: `event-${e.id ?? `${e.event}-${e.created_at}`}`,
        event: e.event,
        actor: e.actor?.login ?? "unknown",
        actorAvatarUrl: e.actor?.avatar_url ?? void 0,
        detail,
        renamedFrom,
        labelColor,
        // The merge commit's short SHA, surfaced so the row reads "merged commit
        // <sha> into <base>". `commitUrl` is filled in by the caller, which has
        // the repo coordinates.
        commitSha: e.event === "merged" && typeof e.commit_id === "string" ? e.commit_id.slice(0, 7) : void 0,
        createdAt: e.created_at
      };
    }
    // Another issue/PR referenced this one ("X mentioned this pull request").
    case "cross-referenced": {
      const src = e.source?.issue;
      if (!src || typeof src.number !== "number") return null;
      const isPullRequest = !!src.pull_request;
      let refState;
      if (isPullRequest && src.pull_request?.merged_at) refState = "merged";
      else if (src.draft) refState = "draft";
      else refState = src.state === "closed" ? "closed" : "open";
      return {
        kind: "reference",
        key: `xref-${src.id ?? src.number}-${e.created_at}`,
        actor: e.actor?.login ?? src.user?.login ?? "unknown",
        actorAvatarUrl: e.actor?.avatar_url ?? void 0,
        refNumber: src.number,
        refTitle: src.title ?? "",
        refUrl: src.html_url ?? "",
        isPullRequest,
        refState,
        createdAt: e.created_at
      };
    }
    default:
      return null;
  }
}
async function listConversation(owner, repo, prNumber, accountId) {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  const [events, commits, prCreatedAt] = await Promise.all([
    o.paginate(o.issues.listEventsForTimeline, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100
    }),
    o.paginate(o.pulls.listCommits, { owner, repo, pull_number: prNumber, per_page: 100 }).catch(() => []),
    o.pulls.get({ owner, repo, pull_number: prNumber }).then((r) => r.data.created_at).catch(() => null)
  ]);
  const commitAvatars = /* @__PURE__ */ new Map();
  for (const c of commits) {
    const avatar = c.author?.avatar_url ?? c.committer?.avatar_url;
    if (avatar) commitAvatars.set(c.sha, avatar);
  }
  const AUTO_REVIEW_WINDOW_MS = 3e4;
  const readyTimes = [];
  if (prCreatedAt) readyTimes.push(Date.parse(prCreatedAt));
  for (const e of events) {
    if (e.event === "ready_for_review" && e.created_at) readyTimes.push(Date.parse(e.created_at));
  }
  const isAutoCopilotRequest = (e) => {
    if (e.event !== "review_requested") return false;
    const r = e.requested_reviewer;
    if (!r || r.type !== "Bot" || r.login !== "Copilot") return false;
    const t = e.created_at ? Date.parse(e.created_at) : NaN;
    if (Number.isNaN(t)) return false;
    return readyTimes.some((rt) => t >= rt && t - rt <= AUTO_REVIEW_WINDOW_MS);
  };
  const items = [];
  for (const e of events) {
    const mapped = mapTimelineItem(e, viewer?.login ?? null);
    if (!mapped) continue;
    if (mapped.kind === "commit") {
      mapped.authorAvatarUrl = commitAvatars.get(mapped.sha) ?? mapped.authorAvatarUrl;
    }
    if (mapped.kind === "event" && isAutoCopilotRequest(e)) {
      const reviewer = e.requested_reviewer;
      mapped.auto = true;
      if (reviewer) {
        mapped.actor = reviewer.login;
        mapped.actorAvatarUrl = reviewer.avatar_url ?? mapped.actorAvatarUrl;
      }
    }
    if (mapped.kind === "event" && mapped.event === "merged" && typeof e.commit_id === "string") {
      mapped.commitUrl = `https://github.com/${owner}/${repo}/commit/${e.commit_id}`;
    }
    items.push(mapped);
  }
  const merged = items.some((i) => i.kind === "event" && i.event === "merged");
  const deduped = merged ? items.filter((i) => !(i.kind === "event" && i.event === "closed")) : items;
  deduped.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : Infinity;
    const bt = b.createdAt ? Date.parse(b.createdAt) : Infinity;
    return at - bt;
  });
  return deduped;
}
async function createIssueComment(owner, repo, prNumber, body, accountId) {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  const res = await o.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body
  });
  const c = res.data;
  return {
    kind: "comment",
    key: `comment-${c.id}`,
    id: c.id,
    author: c.user?.login ?? viewer.login,
    authorAvatarUrl: c.user?.avatar_url ?? "",
    body: c.body ?? body,
    url: c.html_url ?? "",
    createdAt: c.created_at,
    canDelete: true
  };
}
async function deleteIssueComment(owner, repo, commentId, accountId) {
  const o = octokit(resolveAccount(accountId));
  await o.issues.deleteComment({ owner, repo, comment_id: commentId });
}
async function updateIssueComment(owner, repo, commentId, body, accountId) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.issues.updateComment({ owner, repo, comment_id: commentId, body });
  return res.data.body ?? body;
}
async function updatePullRequestBody(owner, repo, prNumber, body, accountId) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.pulls.update({ owner, repo, pull_number: prNumber, body });
  return res.data.body ?? body;
}
async function mergePullRequest(owner, repo, prNumber, method, accountId, commitTitle, commitMessage) {
  const o = octokit(resolveAccount(accountId));
  const res = await o.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    merge_method: method,
    ...commitTitle ? { commit_title: commitTitle } : {},
    ...commitMessage != null ? { commit_message: commitMessage } : {}
  });
  return { merged: res.data.merged, message: res.data.message, sha: res.data.sha };
}
async function markPullRequestReady(owner, repo, prNumber, accountId) {
  const o = octokit(resolveAccount(accountId));
  const { data } = await o.pulls.get({ owner, repo, pull_number: prNumber });
  await o.graphql(
    `mutation ($id: ID!) {
       markPullRequestReadyForReview(input: { pullRequestId: $id }) {
         pullRequest { id isDraft }
       }
     }`,
    { id: data.node_id }
  );
}
function parseLicenseClaims(payloadJson) {
  let raw;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw;
  if (typeof c.sub !== "string" || typeof c.aud !== "string" || typeof c.iss !== "string" || typeof c.iat !== "number" || typeof c.exp !== "number" || typeof c.lic !== "string" || typeof c.dev !== "string" || typeof c.plan !== "string" || typeof c.sta !== "string" || typeof c.fp !== "string") {
    return null;
  }
  if (c.plan !== "trial" && c.plan !== "lifetime") {
    return null;
  }
  if (c.sta !== "active" && c.sta !== "trialing") return null;
  return {
    sub: c.sub,
    aud: c.aud,
    iss: c.iss,
    iat: c.iat,
    exp: c.exp,
    lic: c.lic,
    dev: c.dev,
    plan: c.plan,
    sta: c.sta,
    fp: c.fp,
    tex: typeof c.tex === "number" ? c.tex : null,
    since: typeof c.since === "number" ? c.since : null,
    hn: typeof c.hn === "string" ? c.hn : null,
    he: typeof c.he === "string" ? c.he : null,
    hi: typeof c.hi === "string" ? c.hi : null
  };
}
const LICENSE_AUDIENCE = "super-review-desktop";
function licenseClaimsToState(claims, nowMs, fingerprintHash) {
  if (claims.aud !== LICENSE_AUDIENCE) {
    return { state: "locked", reason: "revoked" };
  }
  if (claims.fp !== fingerprintHash) {
    return { state: "locked", reason: "fingerprint_mismatch" };
  }
  if (nowMs >= claims.exp * 1e3) {
    return { state: "locked", reason: "offline_expired" };
  }
  return {
    state: "licensed",
    plan: claims.plan,
    status: claims.sta,
    trialEndsAt: claims.sta === "trialing" ? claims.tex ?? void 0 : void 0,
    activeSince: claims.since ?? void 0,
    holder: claims.hn || claims.he || claims.hi ? {
      name: claims.hn ?? void 0,
      email: claims.he ?? void 0,
      avatarUrl: claims.hi ?? void 0
    } : void 0,
    offlineExpiresAt: claims.exp * 1e3
  };
}
const execFileAsync = promisify(execFile);
let cached = null;
async function readRawOsId() {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
      const match = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      return match?.[1] ?? null;
    }
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("reg", [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
        "/v",
        "MachineGuid"
      ]);
      const match = stdout.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
      return match?.[1] ?? null;
    }
    for (const path2 of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      try {
        const id = fs.readFileSync(path2, "utf8").trim();
        if (id) return id;
      } catch {
      }
    }
    return null;
  } catch {
    return null;
  }
}
async function getMachineFingerprint() {
  if (cached) return cached;
  const rawOs = await readRawOsId();
  if (rawOs) {
    cached = { value: hash(rawOs), source: "os" };
    return cached;
  }
  let fallback = getFallbackFingerprint();
  if (!fallback) {
    fallback = crypto.randomUUID();
    setFallbackFingerprint(fallback);
  }
  cached = { value: hash(fallback), source: "fallback" };
  return cached;
}
function hash(rawId) {
  return crypto.createHash("sha256").update("super-review:" + rawId).digest("hex");
}
function b64urlToBuffer(input) {
  return Buffer.from(input, "base64url");
}
function verifyEdDSAJwt(jwt, publicKeys) {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "EdDSA" || typeof header.kid !== "string") return null;
  const pem = publicKeys[header.kid.trim()];
  if (!pem) return null;
  try {
    const ok = crypto.verify(
      null,
      Buffer.from(`${headerB64}.${payloadB64}`),
      crypto.createPublicKey(pem),
      b64urlToBuffer(sigB64)
    );
    if (!ok) return null;
  } catch {
    return null;
  }
  return parseLicenseClaims(b64urlToBuffer(payloadB64).toString("utf8"));
}
const LICENSE_PUBLIC_KEYS = {
  lk_a9658e6c: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA2kXsRuUpsog8wYW+YRFe9R637+wTTWWYC5GWwawIUS0=
-----END PUBLIC KEY-----`,
  lk_63d406cf: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAh+VZXQ4vl9YasFAYq84NYevgAu6aO5vQgU5yz0wlDdA=
-----END PUBLIC KEY-----`,
  lk_bbf4174a: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqWoYAUhkJ2/xRwMuYyLi7wYrZN/ZoUbgcX5oOyW27cM=
-----END PUBLIC KEY-----`
};
function verifyLicenseToken(jwt) {
  return verifyEdDSAJwt(jwt, LICENSE_PUBLIC_KEYS);
}
const watchTokenRef = makeFunctionReference(
  "licensing:watchToken"
);
let client = null;
let unsubscribe = null;
let watchedUrl = null;
let watchedKey = null;
let lastSignal = null;
let haveBaseline = false;
function tokenHash(deviceToken) {
  return createHash("sha256").update(deviceToken).digest("hex");
}
function ensureLicenseWatch(convexUrl, deviceToken, onChange) {
  const key = tokenHash(deviceToken);
  if (client && watchedUrl === convexUrl && watchedKey === key) return;
  stopLicenseWatch();
  watchedUrl = convexUrl;
  watchedKey = key;
  let c;
  try {
    c = new ConvexClient(convexUrl, {
      webSocketConstructor: WebSocket
    });
  } catch {
    watchedUrl = null;
    watchedKey = null;
    return;
  }
  client = c;
  const sub = c.onUpdate(
    watchTokenRef,
    { tokenHash: key },
    (signal) => {
      const s = String(signal);
      if (!haveBaseline) {
        haveBaseline = true;
        lastSignal = s;
        return;
      }
      if (s === lastSignal) return;
      lastSignal = s;
      onChange();
    },
    () => {
    }
  );
  unsubscribe = () => sub.unsubscribe();
}
function stopLicenseWatch() {
  try {
    unsubscribe?.();
  } catch {
  }
  unsubscribe = null;
  if (client) {
    void client.close();
    client = null;
  }
  watchedUrl = null;
  watchedKey = null;
  lastSignal = null;
  haveBaseline = false;
}
const DEFAULT_WEB_BASE = "https://superreview.dev";
function webBase() {
  if (!app.isPackaged && process.env["SUPER_REVIEW_API_URL"]) {
    return process.env["SUPER_REVIEW_API_URL"].replace(/\/$/, "");
  }
  return DEFAULT_WEB_BASE;
}
const REVALIDATE_INTERVAL_MS = 8 * 60 * 60 * 1e3;
const CACHE_RECHECK_INTERVAL_MS = 15 * 60 * 1e3;
const WALLCLOCK_HEARTBEAT_MS = 10 * 60 * 1e3;
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1e3;
const MIN_POLL_INTERVAL_MS = 1500;
let current = { state: "unlicensed" };
let clockSuspect = false;
let pending = null;
let activationStatus = { state: "idle" };
function getLicenseState() {
  return current;
}
function isUnlocked() {
  return current.state === "licensed";
}
function getPricingUrl() {
  return `${webBase()}/pricing`;
}
function getDashboardUrl() {
  return `${webBase()}/dashboard`;
}
function broadcast$1() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const wc = win.webContents;
    if (wc.isDestroyed() || wc.isCrashed()) continue;
    try {
      wc.send("license:changed", current);
    } catch {
    }
  }
}
function setState(next) {
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  current = next;
  if (changed) broadcast$1();
}
async function stateFromCache() {
  const { cachedLicenseToken } = getLicenseSlice();
  if (!cachedLicenseToken) return { state: "unlicensed" };
  const claims = verifyLicenseToken(cachedLicenseToken);
  if (!claims) return { state: "unlicensed" };
  const fp = await getMachineFingerprint();
  return licenseClaimsToState(claims, Date.now(), fp.value);
}
async function initLicenseService() {
  const slice = getLicenseSlice();
  const now = Date.now();
  if (slice.lastSeenWallClock && now < slice.lastSeenWallClock - CLOCK_ROLLBACK_TOLERANCE_MS) {
    clockSuspect = true;
  }
  if (!getDeviceToken()) {
    setState({ state: "unlicensed" });
  } else if (clockSuspect) {
    setState({ state: "locked", reason: "clock_rollback" });
  } else {
    setState(await stateFromCache());
  }
  bumpWallClock(now);
  setInterval(() => bumpWallClock(Date.now()), WALLCLOCK_HEARTBEAT_MS);
}
function startLicenseBackgroundWork() {
  void revalidateOnline();
  setInterval(() => void revalidateOnline(), REVALIDATE_INTERVAL_MS);
  setInterval(() => void recheckCache(), CACHE_RECHECK_INTERVAL_MS);
  powerMonitor.on("resume", () => void revalidateOnline());
  app.on("browser-window-focus", () => void revalidateOnFocus());
}
const FOCUS_REVALIDATE_THROTTLE_MS = 30 * 1e3;
let lastFocusRevalidateAt = 0;
async function revalidateOnFocus() {
  const now = Date.now();
  if (now - lastFocusRevalidateAt < FOCUS_REVALIDATE_THROTTLE_MS) return;
  lastFocusRevalidateAt = now;
  await revalidateOnline();
}
async function recheckCache() {
  if (current.state !== "licensed") return;
  const next = await stateFromCache();
  setState(next);
}
async function revalidateOnline() {
  const deviceToken = getDeviceToken();
  if (!deviceToken) {
    setState({ state: "unlicensed" });
    return;
  }
  const fp = await getMachineFingerprint();
  let res;
  try {
    res = await fetch(`${webBase()}/api/license/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        fingerprint: fp.value,
        platform: process.platform,
        appVersion: app.getVersion()
      })
    });
  } catch {
    return;
  }
  if (res.status === 401) {
    stopLicenseWatch();
    setDeviceToken(null);
    setCachedLicenseToken(null);
    setState({ state: "locked", reason: "revoked" });
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return;
  }
  startLicenseWatch(body.convexUrl);
  if (body.ok && body.licenseToken) {
    const claims = verifyLicenseToken(body.licenseToken);
    if (!claims) return;
    setCachedLicenseToken(body.licenseToken);
    if (typeof body.serverTime === "number") setLastValidation(body.serverTime);
    clockSuspect = false;
    setState(licenseClaimsToState(claims, Date.now(), fp.value));
    return;
  }
  if (body.reason) {
    setCachedLicenseToken(null);
    setState(mapDenial(body.reason));
  }
}
function startLicenseWatch(convexUrl) {
  const deviceToken = getDeviceToken();
  if (!convexUrl || !deviceToken) return;
  ensureLicenseWatch(convexUrl, deviceToken, () => void revalidateOnline());
}
function mapDenial(reason) {
  switch (reason) {
    case "waitlist":
      return { state: "locked", reason: "waitlist" };
    case "trial_expired":
      return { state: "locked", reason: "trial_expired" };
    case "suspended":
      return { state: "locked", reason: "suspended" };
    case "fingerprint_mismatch":
      return { state: "locked", reason: "fingerprint_mismatch" };
    case "device_revoked":
    case "invalid_token":
      return { state: "locked", reason: "revoked" };
    case "no_license":
    default:
      return { state: "unlicensed" };
  }
}
async function startActivation() {
  cancelActivation();
  const fp = await getMachineFingerprint();
  let res;
  try {
    res = await fetch(`${webBase()}/api/activation/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fingerprint: fp.value,
        fingerprintSource: fp.source,
        platform: process.platform,
        appVersion: app.getVersion(),
        machineName: hostnameLabel()
      })
    });
  } catch {
    const message = "Could not reach the server";
    activationStatus = { state: "error", message };
    throw new Error(message);
  }
  if (!res.ok) {
    const message = res.status === 429 ? "Too many attempts. Try again later." : "Could not start activation";
    activationStatus = { state: "error", message };
    throw new Error(message);
  }
  const body = await res.json();
  pending = {
    deviceCode: body.deviceCode,
    verificationUri: body.verificationUri,
    expiresAt: body.expiresAt,
    pollTimer: null
  };
  activationStatus = {
    state: "waiting",
    userCode: body.userCode,
    verificationUri: body.verificationUri
  };
  void shell.openExternal(body.verificationUri);
  const interval = Math.max(MIN_POLL_INTERVAL_MS, body.intervalMs || 3e3);
  pending.pollTimer = setInterval(() => void pollServer(), interval);
  return { userCode: body.userCode, verificationUri: body.verificationUri };
}
async function pollServer() {
  if (!pending) return;
  if (Date.now() > pending.expiresAt) {
    stopActivationPolling();
    activationStatus = { state: "error", message: "The code expired. Start again." };
    return;
  }
  const deviceCode = pending.deviceCode;
  const fp = await getMachineFingerprint();
  let res;
  try {
    res = await fetch(`${webBase()}/api/activation/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceCode,
        fingerprint: fp.value,
        fingerprintSource: fp.source,
        platform: process.platform,
        appVersion: app.getVersion(),
        machineName: hostnameLabel()
      })
    });
  } catch {
    return;
  }
  if (!res.ok) {
    if (res.status === 429) return;
    stopActivationPolling();
    activationStatus = { state: "error", message: "Activation failed" };
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return;
  }
  if (body.status === "pending") return;
  if (body.status === "denied") {
    stopActivationPolling();
    activationStatus = { state: "denied" };
    return;
  }
  if (body.status === "approved") {
    stopActivationPolling();
    await applyActivation(body, fp.value);
    return;
  }
  stopActivationPolling();
  activationStatus = { state: "error", message: "The code expired. Start again." };
}
async function applyActivation(body, fingerprint) {
  if (!body.deviceToken) {
    activationStatus = { state: "error", message: "Activation failed" };
    return;
  }
  setDeviceToken(body.deviceToken);
  startLicenseWatch(body.convexUrl);
  if (body.ok && body.licenseToken) {
    const claims = verifyLicenseToken(body.licenseToken);
    if (!claims) {
      activationStatus = {
        state: "error",
        message: "This build could not verify the license the server issued. Please update the app."
      };
      return;
    }
    setCachedLicenseToken(body.licenseToken);
    if (typeof body.serverTime === "number") setLastValidation(body.serverTime);
    clockSuspect = false;
    setState(licenseClaimsToState(claims, Date.now(), fingerprint));
  } else if (body.reason) {
    setState(mapDenial(body.reason));
  }
  activationStatus = { state: "success", license: current };
}
function pollActivation() {
  return activationStatus;
}
function openVerificationPage() {
  if (pending) void shell.openExternal(pending.verificationUri);
}
function cancelActivation() {
  stopActivationPolling();
  if (activationStatus.state === "waiting") activationStatus = { state: "idle" };
}
function stopActivationPolling() {
  if (pending?.pollTimer) clearInterval(pending.pollTimer);
  pending = null;
}
async function signOut() {
  stopLicenseWatch();
  const deviceToken = getDeviceToken();
  if (deviceToken) {
    try {
      await fetch(`${webBase()}/api/device/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${deviceToken}` }
      });
    } catch {
    }
  }
  setDeviceToken(null);
  setCachedLicenseToken(null);
  setState({ state: "unlicensed" });
}
function hostnameLabel() {
  try {
    return os.hostname();
  } catch {
    return "this device";
  }
}
function registerLicenseIpc() {
  ipcMain.handle("license:getStatus", async () => getLicenseState());
  ipcMain.handle(
    "license:startActivation",
    async () => startActivation()
  );
  ipcMain.handle("license:pollActivation", async () => pollActivation());
  ipcMain.handle("license:cancelActivation", async () => cancelActivation());
  ipcMain.handle("license:openVerification", async () => openVerificationPage());
  ipcMain.handle("license:recheck", async () => {
    await revalidateOnline();
    return getLicenseState();
  });
  ipcMain.handle("license:signOut", async () => signOut());
  ipcMain.handle("license:openPricing", async () => {
    await shell.openExternal(getPricingUrl());
  });
  ipcMain.handle("license:openDashboard", async () => {
    await shell.openExternal(getDashboardUrl());
  });
}
const TIMEOUT_MS = 15e3;
async function submitFeedback(input) {
  const token = getDeviceToken();
  let res;
  try {
    res = await fetch(`${webBase()}/api/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...token ? { authorization: `Bearer ${token}` } : {}
      },
      body: JSON.stringify({
        category: input.category,
        title: input.title.trim(),
        body: input.body.trim(),
        email: input.email?.trim() || void 0,
        context: input.context,
        appVersion: app.getVersion(),
        platform: process.platform,
        osRelease: os.release(),
        // Enough to reproduce a platform-specific report without a round
        // trip: Apple silicon vs Intel, and which Electron/Chromium the
        // renderer bug actually happened on.
        arch: process.arch,
        electronVersion: process.versions.electron
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new Error("Couldn't reach the feedback service. Check your connection and try again.");
  }
  if (res.status === 429) {
    throw new Error("You've sent a lot of feedback recently. Try again in a little while.");
  }
  if (!res.ok) {
    throw new Error("Sending feedback failed. Please try again in a moment.");
  }
  const data = await res.json().catch(() => null);
  return { id: data?.id ?? "" };
}
const SUBAGENT_NAME = "super-review-tour-author";
const BUNDLED_SKILLS = [
  {
    name: "document-session",
    label: "Document session skill",
    description: "Teaches agents how and when to record a review session here.",
    files: ["SKILL.md"]
  },
  {
    name: "resolve-comments",
    label: "Resolve comments skill",
    description: "Teaches agents to find and resolve open review comments with the CLI.",
    files: ["SKILL.md"]
  },
  {
    name: "loop-tasks",
    label: "Loop tasks skill",
    description: "Teaches agents to work through the branch's task list until it's clear.",
    files: ["SKILL.md"]
  }
];
const AGENT_MD = `${SUBAGENT_NAME}.md`;
const HARNESS_AI_PATHS = {
  // The shared convention, read by Cursor, Codex, opencode, and Copilot.
  standard: {
    label: ".agents",
    skillsBase: { project: ".agents/skills", global: ".agents/skills" },
    subagent: { project: `.agents/agents/${AGENT_MD}`, global: `.agents/agents/${AGENT_MD}` },
    subagentFormat: "markdown",
    detectDir: null
  },
  // Claude Code does not read `.agents/` — it needs its own directories.
  "claude-code": {
    label: "Claude Code",
    skillsBase: { project: ".claude/skills", global: ".claude/skills" },
    subagent: { project: `.claude/agents/${AGENT_MD}`, global: `.claude/agents/${AGENT_MD}` },
    subagentFormat: "markdown",
    detectDir: ".claude"
  },
  // Codex reads its skill from `.agents/skills` (covered by `standard`), but its
  // custom agents use a TOML file under `.codex/agents`, so it carries only a
  // subagent location and is offered separately when a subagent is selected.
  codex: {
    label: "Codex",
    subagent: {
      project: `.codex/agents/${SUBAGENT_NAME}.toml`,
      global: `.codex/agents/${SUBAGENT_NAME}.toml`
    },
    subagentFormat: "toml",
    detectDir: ".codex"
  }
};
const AI_CONFIG_TARGETS = ["standard", "claude-code", "codex"];
function toCodexToml(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const frontmatter = match ? match[1] : "";
  const body = (match ? match[2] : markdown).trim();
  const name = frontmatterValue(frontmatter, "name") ?? SUBAGENT_NAME;
  const description = frontmatterValue(frontmatter, "description") ?? "";
  return [
    `name = ${tomlBasicString(name)}`,
    `description = ${tomlBasicString(description)}`,
    `developer_instructions = ${tomlMultilineString(body)}`
  ].join("\n") + "\n";
}
function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m"));
  if (!match) return null;
  return match[1].replace(/^["']|["']$/g, "");
}
function tomlBasicString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function tomlMultilineString(value) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  return `"""
${escaped}
"""`;
}
function bundledSkillDir(skillName) {
  return app.isPackaged ? path.join(process.resourcesPath, "skills", skillName) : path.join(app.getAppPath(), "..", "..", ".agents", "skills", skillName);
}
function bundledSubagentFile() {
  const fileName = `${SUBAGENT_NAME}.md`;
  return app.isPackaged ? path.join(process.resourcesPath, "agents", fileName) : path.join(app.getAppPath(), "..", "..", ".agents", "agents", fileName);
}
function parseSkillVersion(skillMd) {
  const frontmatter = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;
  const version = frontmatter[1].match(/^\s*version:\s*["']?(\d+)["']?\s*$/m);
  if (!version) return null;
  const parsed = Number.parseInt(version[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}
async function bundledSkillVersion(skillName) {
  try {
    const src = await promises.readFile(path.join(bundledSkillDir(skillName), "SKILL.md"), "utf8");
    return parseSkillVersion(src);
  } catch {
    return null;
  }
}
function resolveLoc(repoPath, scope, rel) {
  const base = scope === "project" ? repoPath : os.homedir();
  return path.join(base, ...rel.split("/"));
}
function skillLocation(base, skillName) {
  return {
    project: `${base.project}/${skillName}`,
    global: base.global === null ? null : `${base.global}/${skillName}`
  };
}
async function detectSkill(absDir, skillName) {
  let source;
  try {
    source = await promises.readFile(path.join(absDir, "SKILL.md"), "utf8");
  } catch {
    return { installed: false, updateAvailable: false, path: absDir };
  }
  const bundled = await bundledSkillVersion(skillName);
  const installed2 = parseSkillVersion(source);
  const updateAvailable = bundled !== null && (installed2 === null || installed2 < bundled);
  return { installed: true, updateAvailable, path: absDir };
}
async function detectSubagent(absFile, format) {
  let current2;
  try {
    current2 = await promises.readFile(absFile, "utf8");
  } catch {
    return { installed: false, updateAvailable: false, path: absFile };
  }
  const expected = await renderSubagent(format);
  return {
    installed: true,
    updateAvailable: expected !== null && current2 !== expected,
    path: absFile
  };
}
let subagentMarkdownLoaded = false;
let subagentMarkdownCache = null;
async function bundledSubagentMarkdown() {
  if (!subagentMarkdownLoaded) {
    try {
      subagentMarkdownCache = await promises.readFile(bundledSubagentFile(), "utf8");
    } catch {
      subagentMarkdownCache = null;
    }
    subagentMarkdownLoaded = true;
  }
  return subagentMarkdownCache;
}
async function renderSubagent(format) {
  const markdown = await bundledSubagentMarkdown();
  if (markdown === null) return null;
  return format === "toml" ? toCodexToml(markdown) : markdown;
}
async function detectHarnessInstalled(detectDir) {
  if (detectDir === null) return true;
  try {
    await promises.access(path.join(os.homedir(), ...detectDir.split("/")));
    return true;
  } catch {
    return false;
  }
}
async function detectArtifact(repoPath, loc, detect) {
  const project = await detect(resolveLoc(repoPath, "project", loc.project));
  const global = loc.global === null ? null : await detect(resolveLoc(repoPath, "global", loc.global));
  return { project, global };
}
async function getAiConfigStatus(repoPath) {
  subagentMarkdownLoaded = false;
  subagentMarkdownCache = null;
  const targets = [];
  for (const target of AI_CONFIG_TARGETS) {
    const paths = HARNESS_AI_PATHS[target];
    const entry = {
      target,
      harnessDetected: await detectHarnessInstalled(paths.detectDir)
    };
    if (paths.skillsBase) {
      entry.skills = await Promise.all(
        BUNDLED_SKILLS.map(async (skill) => {
          const loc = skillLocation(paths.skillsBase, skill.name);
          const detected = await detectArtifact(
            repoPath,
            loc,
            (abs) => detectSkill(abs, skill.name)
          );
          return { name: skill.name, ...detected };
        })
      );
    }
    if (paths.subagent) {
      entry.subagent = await detectArtifact(
        repoPath,
        paths.subagent,
        (abs) => detectSubagent(abs, paths.subagentFormat)
      );
    }
    targets.push(entry);
  }
  const slots = targets.flatMap(
    (t) => [
      ...(t.skills ?? []).flatMap((s) => [s.project, s.global]),
      t.subagent?.project,
      t.subagent?.global
    ].filter((s) => s != null)
  );
  return {
    targets,
    anyInstalled: slots.some((s) => s.installed),
    anyUpdateAvailable: slots.some((s) => s.installed && s.updateAvailable)
  };
}
function resolveItem(repoPath, item) {
  const paths = HARNESS_AI_PATHS[item.target];
  if (item.artifact === "skill") {
    if (!paths.skillsBase) return `${item.target} has no skill location`;
    if (!item.skill) return `${item.target} skill install is missing a skill name`;
    if (!BUNDLED_SKILLS.some((s) => s.name === item.skill)) {
      return `unknown skill "${item.skill}"`;
    }
    const loc2 = skillLocation(paths.skillsBase, item.skill);
    const rel2 = item.scope === "project" ? loc2.project : loc2.global;
    if (rel2 === null) return `${item.target} skill has no global location`;
    return {
      dest: resolveLoc(repoPath, item.scope, rel2),
      artifact: "skill",
      format: paths.subagentFormat,
      skill: item.skill
    };
  }
  const loc = paths.subagent;
  if (!loc) return `${item.target} has no subagent location`;
  const rel = item.scope === "project" ? loc.project : loc.global;
  if (rel === null) return `${item.target} subagent has no global location`;
  return {
    dest: resolveLoc(repoPath, item.scope, rel),
    artifact: "subagent",
    format: paths.subagentFormat
  };
}
async function writeArtifact(dest, artifact, format, skill) {
  if (artifact === "skill") {
    await promises.rm(dest, { recursive: true, force: true });
    await promises.mkdir(path.dirname(dest), { recursive: true });
    await promises.cp(bundledSkillDir(skill), dest, { recursive: true });
  } else {
    const contents = await renderSubagent(format);
    if (contents === null) throw new Error("subagent template is no longer bundled");
    await promises.mkdir(path.dirname(dest), { recursive: true });
    await promises.writeFile(dest, contents, "utf8");
  }
}
async function applyAiConfig(repoPath, request) {
  subagentMarkdownLoaded = false;
  subagentMarkdownCache = null;
  const byDest = /* @__PURE__ */ new Map();
  const results = [];
  for (const item of request.items) {
    const resolved = resolveItem(repoPath, item);
    if (typeof resolved === "string") {
      results.push({ item, ok: false, error: resolved });
      continue;
    }
    let outcome = byDest.get(resolved.dest);
    if (!outcome) {
      try {
        await writeArtifact(resolved.dest, resolved.artifact, resolved.format, resolved.skill);
        outcome = { ok: true };
      } catch (err) {
        outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      byDest.set(resolved.dest, outcome);
    }
    results.push({ item, ...outcome });
  }
  return { results };
}
async function removeAiConfig(repoPath, item) {
  const resolved = resolveItem(repoPath, item);
  if (typeof resolved === "string") return { ok: false, error: resolved };
  try {
    await promises.rm(resolved.dest, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_RE = new RegExp(
  [
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}\\[[0-9;?]*[ -/]*[@-~]`,
    `${ESC}[@-Z\\\\-_]`
  ].join("|"),
  "g"
);
const PARTIAL_ANSI_RE = new RegExp(`${ESC}(?:\\][^${BEL}${ESC}]*|\\[[0-9;?]*[ -/]*)?$`, "gm");
function stripAnsi(text2) {
  return text2.replace(ANSI_RE, "").replace(PARTIAL_ANSI_RE, "");
}
const AUTH_PATTERNS = [
  // Claude Code: the exact string this whole change started from.
  /oauth session expired/i,
  /failed to authenticate/i,
  // Shared across CLIs.
  /\bnot logged ?in\b/i,
  /\bnot authenticated\b/i,
  /\bplease log ?in\b/i,
  /\bplease sign ?in\b/i,
  /\bauthentication (?:failed|required|error)\b/i,
  /\bunauthenticated\b/i,
  /\bunauthori[sz]ed\b/i,
  /\b(?:invalid|expired|missing|revoked) (?:api ?key|token|credentials?|session)\b/i,
  /\bsession (?:has )?expired\b/i,
  /\brun `?(?:claude|codex|cursor-agent|agent|copilot|opencode)[^`\n]*\b(?:login|auth)\b/i,
  // Bare HTTP status lines. 403 is included because every CLI here uses it for
  // "your session is fine but it isn't allowed to do this", which the user
  // still fixes by signing in again.
  /\bhttp (?:401|403)\b/i,
  /\bstatus (?:code )?(?:401|403)\b/i,
  /\b(?:401|403) (?:unauthori[sz]ed|forbidden)\b/i
];
function looksLikeAuthFailure(raw) {
  if (!raw) return false;
  const cleaned = stripAnsi(raw);
  if (!cleaned.trim()) return false;
  return AUTH_PATTERNS.some((pattern) => pattern.test(cleaned));
}
function explainAuthFailure(harness, raw) {
  const headline = `${harnessLabel(harness)} isn't signed in. To fix it, ${harnessLoginHint(harness)} in a terminal, then try again.`;
  const detail = firstMeaningfulLine(raw);
  return detail ? `${headline}

${detail}` : headline;
}
function firstMeaningfulLine(raw) {
  if (!raw) return null;
  const line = stripAnsi(raw).split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;
  return line.replace(/^error:\s*/i, "").trim() || null;
}
const GENERATION_TIMEOUT_MS = 9e4;
const AGENT_TIMEOUT_MS = 6e5;
function spawnCapture(command, args, opts) {
  const timeoutMs = opts.timeoutMs ?? GENERATION_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const killChild = (child2) => {
      try {
        child2.kill("SIGTERM");
      } catch {
      }
      setTimeout(() => {
        try {
          child2.kill("SIGKILL");
        } catch {
        }
      }, 2e3);
    };
    if (opts.signal?.aborted) {
      finish({
        ok: false,
        stdout: "",
        stderr: "",
        code: null,
        timedOut: false,
        cancelled: true,
        error: "Cancelled"
      });
      return;
    }
    let child;
    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (err) {
      finish({
        ok: false,
        stdout: "",
        stderr: "",
        code: null,
        timedOut: false,
        error: err instanceof Error ? err.message : String(err)
      });
      return;
    }
    opts.onSpawn?.(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      opts.onStdoutChunk?.(chunk);
      opts.onStdout?.(stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      opts.onStderrChunk?.(chunk);
    });
    const onAbort = () => {
      killChild(child);
      finish({
        ok: false,
        stdout,
        stderr,
        code: null,
        timedOut: false,
        cancelled: true,
        error: "Cancelled"
      });
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      killChild(child);
      finish({
        ok: false,
        stdout,
        stderr,
        code: null,
        timedOut: true,
        error: `Timed out after ${Math.round(timeoutMs / 1e3)}s`
      });
    }, timeoutMs);
    child.on("error", (err) => {
      finish({
        ok: false,
        stdout,
        stderr,
        code: null,
        timedOut: false,
        error: err.message
      });
    });
    child.on("close", (code) => {
      if (opts.signal?.aborted) {
        finish({
          ok: false,
          stdout,
          stderr,
          code: null,
          timedOut: false,
          cancelled: true,
          error: "Cancelled"
        });
        return;
      }
      finish({
        ok: code === 0,
        stdout,
        stderr,
        code,
        timedOut: false,
        error: code === 0 ? void 0 : stderr.trim() || `Exited with code ${code}`
      });
    });
    if (opts.stdin != null) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}
const UNKNOWN = { auth: "unknown" };
const PROBE_TIMEOUT_MS = 1e4;
const CACHE_TTL_MS = 6e4;
const cache$2 = /* @__PURE__ */ new Map();
function clearHarnessAuthCache() {
  cache$2.clear();
}
async function probeHarnessAuth(harness, binary) {
  const key = `${harness}:${binary}`;
  const hit = cache$2.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.probe;
  let probe;
  try {
    probe = await runProbe(harness, binary);
  } catch {
    probe = UNKNOWN;
  }
  cache$2.set(key, { at: Date.now(), probe });
  return probe;
}
function runProbe(harness, binary) {
  switch (harness) {
    case "claude-code":
      return probeClaude(binary);
    case "cursor":
      return probeCursor(binary);
    case "codex":
      return probeCodex(binary);
    case "opencode":
      return probeOpenCode(binary);
    case "copilot":
      return Promise.resolve(UNKNOWN);
  }
}
async function probeClaude(binary) {
  const request = JSON.stringify({
    type: "control_request",
    request_id: "super-review-auth-probe",
    request: { subtype: "initialize" }
  }) + "\n";
  let account = null;
  let done = false;
  let kill = null;
  let buffer = "";
  const onChunk = (chunk) => {
    if (done) return;
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type !== "control_response") continue;
      const response = event.response?.response;
      account = response?.account ?? {};
      done = true;
      kill?.();
      return;
    }
  };
  await spawnCapture(
    binary,
    ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
    {
      cwd: process.cwd(),
      stdin: request,
      timeoutMs: PROBE_TIMEOUT_MS,
      onStdoutChunk: onChunk,
      onSpawn: (child) => {
        kill = () => {
          try {
            child.kill("SIGKILL");
          } catch {
          }
        };
      }
    }
  );
  if (!account) return UNKNOWN;
  const { tokenSource, apiProvider, email, subscriptionType } = account;
  if (!tokenSource) return UNKNOWN;
  if (tokenSource === "none" && apiProvider && apiProvider !== "firstParty") return UNKNOWN;
  if (tokenSource === "none") return { auth: "missing" };
  return {
    auth: "ok",
    ...email ? { account: email } : {},
    ...subscriptionType ? { plan: subscriptionType } : {}
  };
}
async function probeCursor(binary) {
  const result = await spawnCapture(binary, ["status", "--format", "json"], {
    cwd: process.cwd(),
    timeoutMs: PROBE_TIMEOUT_MS
  });
  if (result.timedOut) return UNKNOWN;
  const parsed = parseJsonObject(result.stdout);
  if (!parsed) return UNKNOWN;
  const authenticated = typeof parsed.isAuthenticated === "boolean" ? parsed.isAuthenticated : parsed.status === "authenticated" ? true : parsed.status === "unauthenticated" ? false : void 0;
  if (authenticated === void 0) return UNKNOWN;
  if (!authenticated) return { auth: "missing" };
  const email = parsed.userInfo?.email;
  return { auth: "ok", ...typeof email === "string" && email ? { account: email } : {} };
}
async function probeCodex(binary) {
  const result = await spawnCapture(binary, ["login", "status"], {
    cwd: process.cwd(),
    timeoutMs: PROBE_TIMEOUT_MS
  });
  if (result.timedOut) return UNKNOWN;
  const text2 = stripAnsi(`${result.stdout}
${result.stderr}`);
  if (/\bnot logged ?in\b/i.test(text2)) return { auth: "missing" };
  const loggedIn = text2.match(/logged in(?: using ([^\n.]+))?/i);
  if (!loggedIn) return UNKNOWN;
  const method = loggedIn[1]?.trim();
  return { auth: "ok", ...method ? { plan: method } : {} };
}
async function probeOpenCode(binary) {
  const result = await spawnCapture(binary, ["auth", "list"], {
    cwd: process.cwd(),
    timeoutMs: PROBE_TIMEOUT_MS
  });
  if (result.timedOut) return UNKNOWN;
  const text2 = stripAnsi(`${result.stdout}
${result.stderr}`);
  const count = text2.match(/(\d+)\s+credentials?\b/i);
  if (!count) return UNKNOWN;
  const parsedCount = Number(count[1]);
  if (!Number.isFinite(parsedCount)) return UNKNOWN;
  if (parsedCount === 0) return { auth: "missing" };
  return { auth: "ok", plan: `${parsedCount} provider${parsedCount === 1 ? "" : "s"}` };
}
function parseJsonObject(raw) {
  const text2 = stripAnsi(raw);
  const start = text2.indexOf("{");
  const end = text2.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text2.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
async function which(cmd) {
  return await new Promise((resolve) => {
    const finder = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe") : "which";
    const child = spawn(finder, [cmd], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: {
        ...process.env,
        PATH: augmentedPath()
      }
    });
    let out = "";
    child.stdout.on("data", (b) => out += String(b));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const exe = lines.find((l) => /\.exe$/i.test(l));
      const cmdShim = lines.find((l) => /\.(cmd|bat)$/i.test(l));
      const withExt = lines.find((l) => path.extname(l) !== "");
      resolve(exe || cmdShim || withExt || lines[0] || null);
    });
    child.on("error", () => resolve(null));
  });
}
function augmentedPath() {
  const home = homedir();
  const extras = process.platform === "win32" ? [process.env.PATH ?? ""] : [`${home}/.local/bin`, "/usr/local/bin", "/opt/homebrew/bin", process.env.PATH ?? ""];
  return extras.filter(Boolean).join(path.delimiter);
}
const HARNESS_BINARIES = {
  // Prefer `agent` (current Cursor CLI); fall back to the older `cursor-agent`.
  cursor: ["agent", "cursor-agent"],
  "claude-code": ["claude"],
  codex: ["codex"],
  copilot: ["copilot"],
  opencode: ["opencode"]
};
async function resolveHarnessBinary(harness) {
  for (const name of HARNESS_BINARIES[harness]) {
    const bin = await which(name);
    if (bin) return bin;
  }
  return null;
}
const NOT_INSTALLED = { installed: false, auth: "unknown" };
async function detectCommitMessageHarnesses() {
  const status = {};
  await Promise.all(
    COMMIT_MESSAGE_HARNESS_PRIORITY.map(async (harness) => {
      const binary = await resolveHarnessBinary(harness);
      if (!binary) {
        status[harness] = NOT_INSTALLED;
        return;
      }
      const probe = await probeHarnessAuth(harness, binary);
      status[harness] = { installed: true, ...probe };
    })
  );
  return status;
}
function resolvePreferredHarness(status, preferred) {
  if (preferred && status[preferred]?.installed) return preferred;
  for (const harness of COMMIT_MESSAGE_HARNESS_PRIORITY) {
    const info = status[harness];
    if (info?.installed && info.auth !== "missing") return harness;
  }
  for (const harness of COMMIT_MESSAGE_HARNESS_PRIORITY) {
    if (status[harness]?.installed) return harness;
  }
  return null;
}
async function resolveHarnessForRun(preferred) {
  const status = await detectCommitMessageHarnesses();
  const harness = resolvePreferredHarness(status, preferred);
  if (!harness) {
    return {
      ok: false,
      code: "no-harness",
      error: "No supported coding agent CLI found. Install Cursor, Claude Code, Codex, Copilot, or OpenCode and try again."
    };
  }
  const binary = await resolveHarnessBinary(harness);
  if (!binary) {
    return {
      ok: false,
      code: "no-harness",
      error: `${harnessLabel(harness)} CLI was detected earlier but is no longer available.`
    };
  }
  if (status[harness]?.auth === "missing") {
    return {
      ok: false,
      code: "auth",
      harness,
      error: explainSignedOut(harness)
    };
  }
  return { ok: true, harness, binary };
}
function explainSignedOut(harness) {
  return `${harnessLabel(harness)} isn't signed in.`;
}
const MAX_STATUS = 60;
const VERBS = [
  [/^(read|read_file|view|open|cat|file_read)/i, "read"],
  [/^(grep|search|codebase_search|ripgrep|find_text|glob|file_search)/i, "search"],
  [/^(ls|list|list_dir|list_files|tree)/i, "list"],
  [/^(bash|shell|run|exec|terminal|command|local_shell)/i, "run"],
  [/^(write|create|new_file|file_write)/i, "write"],
  [/^(edit|apply_patch|str_replace|multi_edit|patch|update_file)/i, "edit"],
  [/^(fetch|web|url|browse|http)/i, "fetch"],
  [/^(think|reason|plan|todo)/i, "think"]
];
function verbFor(name) {
  for (const [re, verb] of VERBS) if (re.test(name)) return verb;
  return null;
}
function subjectOf(input, keys) {
  if (!input || typeof input !== "object") return null;
  const obj = input;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
const PATH_KEYS = ["file_path", "path", "filePath", "target_file", "filename", "file", "abs_path"];
const QUERY_KEYS = ["pattern", "query", "search", "regex", "q"];
const COMMAND_KEYS = ["command", "cmd", "script", "shell_command"];
function basename(p) {
  const clean = p.replace(/[/\\]+$/, "");
  const cut = clean.lastIndexOf("/");
  const cutWin = clean.lastIndexOf("\\");
  return clean.slice(Math.max(cut, cutWin) + 1) || clean;
}
const SHELL_NOISE = /* @__PURE__ */ new Set(["echo", "printf", "for", "while", "if", "then", "true", ":", "cd"]);
const READ_COMMANDS = /* @__PURE__ */ new Set(["cat", "head", "tail", "less", "more", "wc", "nl"]);
const SEARCH_COMMANDS = /* @__PURE__ */ new Set(["grep", "rg", "ag", "ack", "find"]);
function describeCommand(command) {
  const first = command.split(/&&|\|\||[|;\n]/)[0].trim();
  const words = first.split(/\s+/).filter(Boolean);
  while (words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[0])) words.shift();
  const program = basename(words.shift() ?? "");
  if (!program || SHELL_NOISE.has(program)) return null;
  const args = words.filter((w) => !w.startsWith("-")).map(unquote);
  if (READ_COMMANDS.has(program)) {
    return args[0] ? `Reading ${basename(args[0])}` : "Reading the code";
  }
  if (SEARCH_COMMANDS.has(program)) {
    return args[0] ? `Searching for ${truncate(args[0], 32)}` : "Searching the code";
  }
  const detail = args[0] ? args[0].includes("/") ? basename(args[0]) : args[0] : "";
  return detail ? `Running ${program} ${truncate(detail, 24)}` : `Running ${program}`;
}
function unquote(word) {
  return word.replace(/^['"]+/, "").replace(/['"]+$/, "");
}
function describeToolCall(call) {
  const verb = verbFor(call.name);
  if (!verb) return null;
  switch (verb) {
    case "read": {
      const path2 = subjectOf(call.input, PATH_KEYS);
      return path2 ? `Reading ${basename(path2)}` : "Reading the code";
    }
    case "search": {
      const query = subjectOf(call.input, QUERY_KEYS);
      return query ? `Searching for ${truncate(query, 32)}` : "Searching the code";
    }
    case "list": {
      const path2 = subjectOf(call.input, PATH_KEYS);
      return path2 ? `Looking through ${basename(path2)}` : "Looking around the repo";
    }
    case "run": {
      const command = subjectOf(call.input, COMMAND_KEYS);
      return command ? describeCommand(command) : "Running a command";
    }
    case "write": {
      const path2 = subjectOf(call.input, PATH_KEYS);
      return path2 ? `Writing ${basename(path2)}` : "Writing the changeset";
    }
    case "edit": {
      const path2 = subjectOf(call.input, PATH_KEYS);
      return path2 ? `Editing ${basename(path2)}` : "Editing the changeset";
    }
    case "fetch":
      return "Reading the pull request";
    case "think":
      return "Thinking it through";
  }
}
function truncate(text2, max) {
  const flat = text2.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
function clampStatus(status) {
  return truncate(status, MAX_STATUS);
}
function combineCliOutput(stdout, stderr) {
  const out = stripAnsi(stdout).trim();
  const err = stripAnsi(stderr).trim();
  if (out && err) return `${err}
${out}`;
  return err || out;
}
function explainOpenCodeFailure(raw, opts) {
  const { model, modelCount } = opts;
  const cleaned = stripAnsi(raw).trim();
  const structured = extractStructuredError(cleaned);
  const message = structured?.message ?? cleaned;
  const lower = message.toLowerCase();
  if (/\b(not logged in|unauthori[sz]ed|authentication|auth required|please log ?in|sign[- ]?in)\b/.test(
    lower
  ) || /\b(401|403)\b/.test(lower)) {
    return `OpenCode isn't authenticated. Run \`opencode auth login\` in a terminal, then try again.`;
  }
  if (/\b(model .+ not found|unknown model|no such model|model unavailable)\b/.test(lower)) {
    return `OpenCode doesn't have model \`${model}\` available` + (modelCount > 0 ? ` (your providers list ${modelCount} model${modelCount === 1 ? "" : "s"})` : "") + `. Pick another harness in Agents settings, or run \`opencode auth login\` to add a provider.`;
  }
  if (/\b(no provider|provider .+ not (found|configured|available)|missing api key|invalid api key)\b/.test(
    lower
  )) {
    return `OpenCode has no usable provider for \`${model}\`. Run \`opencode auth login\` (or add an API key), then try again.`;
  }
  if (structured?.name === "UnknownError" || /unexpected server error/i.test(message) || /^error:\s*\{/.test(cleaned.toLowerCase())) {
    const ref = structured?.ref ? ` (ref ${structured.ref})` : "";
    if (modelCount > 0) {
      const tried = opts.triedModels?.length ? ` Tried: ${opts.triedModels.map((m) => `\`${m}\``).join(", ")}.` : "";
      return `OpenCode rejected \`${model}\`${ref}. Your providers list ${modelCount} model${modelCount === 1 ? "" : "s"}, but this one isn't callable (wrong access, quota, or a bad models.dev listing).${tried} Add another provider with \`opencode auth login\`, or pick a different harness in Agents settings.`;
    }
    return `OpenCode failed with an unexpected server error${ref}. Usually this means you aren't signed in, or no provider is set up. Run \`opencode auth login\` in a terminal (or check Agents settings for another harness).`;
  }
  if (!cleaned) return "OpenCode failed to generate a commit message.";
  const firstLine = cleaned.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return "OpenCode failed to generate a commit message.";
  return firstLine.replace(/^error:\s*/i, "").trim() || firstLine;
}
function explainOpenCodeNoModels(detail) {
  const cleaned = detail ? stripAnsi(detail).trim() : "";
  if (cleaned && /\b(not logged in|unauthori[sz]ed|authentication|auth required|please log ?in|sign[- ]?in)\b/i.test(
    cleaned
  )) {
    return `OpenCode isn't authenticated. Run \`opencode auth login\` in a terminal, then try again.`;
  }
  return `OpenCode has no models available from your configured providers. Run \`opencode auth login\` to sign in or add a provider, then try again.`;
}
function extractStructuredError(raw) {
  const body = raw.replace(/^error:\s*/i, "").trim();
  const jsonText = extractJsonObject(body);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    const message = typeof parsed.data?.message === "string" && parsed.data.message || typeof parsed.message === "string" && parsed.message || null;
    if (!message) return null;
    return {
      name: typeof parsed.name === "string" ? parsed.name : void 0,
      message,
      ref: typeof parsed.data?.ref === "string" ? parsed.data.ref : void 0
    };
  } catch {
    return null;
  }
}
function extractJsonObject(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return raw.slice(start, end + 1);
}
function isRetryableOpenCodeModelFailure(raw) {
  const cleaned = stripAnsi(raw).trim();
  const structured = extractStructuredError(cleaned);
  const message = (structured?.message ?? cleaned).toLowerCase();
  if (structured?.name === "UnknownError") return true;
  if (/unexpected server error/i.test(message)) return true;
  if (/\b(model .+ not found|unknown model|no such model|model unavailable)\b/.test(message)) {
    return true;
  }
  if (/\b(no provider|provider .+ not (found|configured|available)|missing api key|invalid api key)\b/.test(
    message
  )) {
    return true;
  }
  if (/\b(401|403|429|500|502|503)\b/.test(message)) return true;
  return false;
}
const EMIT_INTERVAL_MS = 50;
function createStreamReporter(onProgress) {
  let thinking = "";
  let answer = "";
  let lastEmitted = "";
  let lastEmitAt = 0;
  let timer;
  const render = () => ({
    reasoning: stripAnsi(thinking).trim(),
    answer: formatCommitMessageStream(answer)
  });
  const emit = () => {
    timer = void 0;
    lastEmitAt = Date.now();
    const next = render();
    const key = `${next.reasoning}\0${next.answer}`;
    if (key === lastEmitted) return;
    lastEmitted = key;
    onProgress?.(next);
  };
  const schedule = () => {
    if (!onProgress || timer) return;
    const wait = Math.max(0, EMIT_INTERVAL_MS - (Date.now() - lastEmitAt));
    timer = setTimeout(emit, wait);
  };
  return {
    addThinking(delta) {
      if (!delta) return;
      thinking += delta;
      schedule();
    },
    setThinking(text2) {
      if (text2 === thinking) return;
      thinking = text2;
      schedule();
    },
    addAnswer(delta) {
      if (!delta) return;
      answer += delta;
      schedule();
    },
    setAnswer(text2) {
      if (text2 === answer) return;
      answer = text2;
      schedule();
    },
    answerText() {
      return answer;
    },
    reset() {
      if (!thinking && !answer) return;
      thinking = "";
      answer = "";
      schedule();
    },
    flush() {
      if (timer) clearTimeout(timer);
      emit();
    }
  };
}
function createLineReader(onLine) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onLine(line);
    }
    if (buffer.length > 1e6) buffer = "";
  };
}
function formatCommitMessageStream(raw) {
  const text2 = stripAnsi(raw).trim();
  if (!text2) return "";
  if (text2.startsWith("{")) {
    const subject = readPartialJsonString(text2, "subject")?.trim();
    const body = readPartialJsonString(text2, "body")?.trim();
    return [subject, body].filter(Boolean).join("\n\n");
  }
  return text2.replace(/^```[^\n]*\n?/, "").replace(/```\s*$/, "").trim();
}
function readPartialJsonString(source, key) {
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex < 0) return null;
  let i = keyIndex + key.length + 2;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== ":") return null;
  i++;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== '"') return null;
  i++;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      if (next === void 0) return out;
      switch (next) {
        case "n":
          out += "\n";
          break;
        case "t":
          out += "	";
          break;
        case "r":
          break;
        case "u": {
          const hex = source.slice(i + 2, i + 6);
          if (hex.length < 4) return out;
          const code = Number.parseInt(hex, 16);
          if (!Number.isNaN(code)) out += String.fromCharCode(code);
          i += 6;
          continue;
        }
        default:
          out += next;
      }
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i++;
  }
  return out;
}
const DEFAULT_MODEL$2 = "haiku";
const DEFAULT_AGENT_MODEL = "sonnet";
async function generateWithClaude(input) {
  const agentic = input.tools === "workspace";
  const model = input.model?.trim() || (agentic ? DEFAULT_AGENT_MODEL : DEFAULT_MODEL$2);
  const reporter = createStreamReporter(input.onProgress);
  const state = { result: null };
  let sawDelta = false;
  const readLine = createLineReader((line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "result") {
      state.result = event;
      return;
    }
    if (event.type === "assistant") {
      reportToolUse(event, input.onActivity);
      if (!sawDelta) {
        const text2 = collectAssistantText(event);
        if (text2) reporter.setAnswer(text2);
      }
      return;
    }
    if (event.type !== "stream_event") return;
    const inner = event.event;
    if (inner?.type !== "content_block_delta") return;
    const delta = inner.delta;
    if (!delta) return;
    if (delta.type === "thinking_delta" && delta.thinking) {
      sawDelta = true;
      reporter.addThinking(delta.thinking);
      return;
    }
    if (delta.type === "text_delta" && delta.text) {
      sawDelta = true;
      reporter.addAnswer(delta.text);
    }
  });
  try {
    const result = await spawnCapture(
      input.binary,
      [
        "-p",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        // stream-json output requires --verbose in print mode.
        "--verbose",
        "--model",
        model,
        "--dangerously-skip-permissions"
      ],
      {
        cwd: input.cwd,
        stdin: input.prompt,
        signal: input.signal,
        // Exploring a repo is a different order of work than writing one
        // paragraph from a patch that's already in the prompt.
        timeoutMs: agentic ? AGENT_TIMEOUT_MS : void 0,
        onStdoutChunk: readLine
      }
    );
    if (result.cancelled) {
      return { ok: false, code: "cancelled", error: "Cancelled" };
    }
    if (result.timedOut) {
      return { ok: false, code: "timeout", error: result.error ?? "Timed out" };
    }
    const failed = state.result?.is_error === true;
    const answer = failed ? "" : state.result?.result ?? reporter.answerText();
    if (!answer.trim()) {
      return {
        ok: false,
        code: result.ok && !failed ? "empty" : "failed",
        error: (failed ? state.result?.result : void 0) ?? result.error ?? "Claude returned an empty response."
      };
    }
    return { ok: true, text: answer };
  } finally {
    reporter.flush();
  }
}
function reportToolUse(event, onActivity) {
  if (!onActivity) return;
  const message = event.message;
  if (!Array.isArray(message?.content)) return;
  for (const block of message.content) {
    if (block.type !== "tool_use" || typeof block.name !== "string") continue;
    const status = describeToolCall({ name: block.name, input: block.input });
    if (status) onActivity(status);
  }
}
function collectAssistantText(event) {
  const message = event.message;
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}
const cache$1 = /* @__PURE__ */ new Map();
async function cliSupportsFlag(binary, helpArgs, flag, cwd) {
  const key = `${binary} ${helpArgs.join(" ")} ${flag}`;
  const cached2 = cache$1.get(key);
  if (cached2 != null) return cached2;
  let supported;
  try {
    const help = await spawnCapture(binary, helpArgs, { cwd, timeoutMs: 1e4 });
    const text2 = `${help.stdout}
${help.stderr}`;
    const pattern = new RegExp(`(^|[\\s,])${escapeRegExp(flag)}(?![\\w-])`);
    supported = pattern.test(text2);
  } catch {
    supported = false;
  }
  cache$1.set(key, supported);
  return supported;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const HANDSHAKE_TIMEOUT_MS = 15e3;
async function runCodexAppServerTurn(opts) {
  if (opts.signal?.aborted) {
    return { ok: false, text: "", cancelled: true, error: "Cancelled" };
  }
  let child;
  try {
    child = spawn(opts.binary, ["app-server"], {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
  } catch {
    return { ok: false, text: "", unavailable: true };
  }
  let nextId = 1;
  const pending2 = /* @__PURE__ */ new Map();
  let settled = false;
  let settle = () => void 0;
  const outcome = new Promise((resolve) => {
    settle = resolve;
  });
  let finalText = "";
  let streamedText = "";
  const kill = () => {
    try {
      child.kill("SIGTERM");
    } catch {
    }
  };
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    kill();
    for (const [, waiter] of pending2) waiter.reject(new Error("Cancelled"));
    pending2.clear();
    settle(result);
  };
  const onAbort = () => finish({ ok: false, text: "", cancelled: true, error: "Cancelled" });
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => finish({ ok: false, text: "", timedOut: true, error: "Timed out" }),
    opts.timeoutMs
  );
  const write = (payload) => {
    child.stdin.write(`${JSON.stringify(payload)}
`);
  };
  const request = (method, params) => {
    const id = nextId++;
    write({ method, id, params });
    return new Promise((resolve, reject) => pending2.set(id, { resolve, reject }));
  };
  const notify = (method, params) => write({ method, params });
  child.on("error", () => finish({ ok: false, text: "", unavailable: true }));
  child.on("close", () => {
    finish({ ok: false, text: "", unavailable: true });
  });
  child.stderr.resume();
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (message.id != null && (message.result !== void 0 || message.error !== void 0)) {
      const waiter = pending2.get(message.id);
      if (!waiter) return;
      pending2.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "Codex error"));
      else waiter.resolve(message.result);
      return;
    }
    if (!message.method) return;
    const params = message.params ?? {};
    switch (message.method) {
      case "item/agentMessage/delta": {
        const delta = typeof params.delta === "string" ? params.delta : "";
        streamedText += delta;
        opts.reporter.addAnswer(delta);
        return;
      }
      case "item/reasoning/delta": {
        const delta = typeof params.delta === "string" ? params.delta : "";
        opts.reporter.addThinking(delta);
        return;
      }
      case "item/completed": {
        const item = params.item;
        if (!item) return;
        const kind = item.item_type ?? item.type;
        if (kind === "agent_message" && typeof item.text === "string") {
          finalText = item.text;
          opts.reporter.setAnswer(item.text);
        }
        return;
      }
      case "turn/completed": {
        const turn = params.turn;
        if (!finalText) finalText = collectAgentMessage(turn?.items) || streamedText;
        finish({ ok: true, text: finalText });
        return;
      }
      case "turn/failed": {
        const error = params.error;
        finish({
          ok: false,
          text: finalText || streamedText,
          error: error?.message ?? "Codex turn failed."
        });
        return;
      }
      default:
        return;
    }
  });
  try {
    await withTimeout(
      (async () => {
        await request("initialize", {
          clientInfo: {
            name: "super-review",
            title: "Super Review",
            version: "1.0.0"
          },
          capabilities: { experimentalApi: true }
        });
        notify("initialized", {});
        const thread = await request("thread/start", {
          model: opts.model,
          cwd: opts.cwd,
          approvalPolicy: "never",
          sandbox: "readOnly"
        });
        const threadId = thread?.thread?.id ?? thread?.threadId ?? thread?.id;
        if (!threadId) throw new Error("No thread id");
        await request("turn/start", {
          threadId,
          input: [{ type: "text", text: opts.prompt }],
          cwd: opts.cwd,
          model: opts.model,
          effort: "low",
          // Same contract as `exec --output-schema`, so the JSON shape never
          // has to be spelled out in the prompt.
          ...opts.outputSchema ? { outputSchema: opts.outputSchema } : {}
        });
      })(),
      HANDSHAKE_TIMEOUT_MS
    );
  } catch {
    if (opts.signal?.aborted) {
      finish({ ok: false, text: "", cancelled: true, error: "Cancelled" });
    } else {
      finish({ ok: false, text: "", unavailable: true });
    }
  }
  return outcome;
}
function collectAgentMessage(items) {
  if (!Array.isArray(items)) return "";
  const texts = [];
  for (const item of items) {
    const kind = item.item_type ?? item.type;
    if (kind === "agent_message" && typeof item.text === "string") texts.push(item.text);
  }
  return texts.join("\n");
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
const DEFAULT_MODEL$1 = "gpt-5.6-luna";
async function generateWithCodex(input) {
  const model = input.model?.trim() || DEFAULT_MODEL$1;
  const reporter = createStreamReporter(input.onProgress);
  try {
    if (input.tools === "workspace") {
      return await generateWithCodexExec(input, model, reporter);
    }
    const streamed = await runCodexAppServerTurn({
      binary: input.binary,
      cwd: input.cwd,
      prompt: input.prompt,
      model,
      timeoutMs: GENERATION_TIMEOUT_MS,
      signal: input.signal,
      reporter
    });
    if (streamed.cancelled) return { ok: false, code: "cancelled", error: "Cancelled" };
    if (streamed.timedOut) {
      return { ok: false, code: "timeout", error: streamed.error ?? "Timed out" };
    }
    if (!streamed.unavailable) {
      if (streamed.text.trim()) return { ok: true, text: streamed.text };
      if (streamed.error) {
        return { ok: false, code: "failed", error: streamed.error };
      }
    }
    return await generateWithCodexExec(input, model, reporter);
  } finally {
    reporter.flush();
  }
}
async function generateWithCodexExec(input, model, reporter) {
  const dir = await mkdtemp(path.join(tmpdir(), "sr-codex-"));
  const outputPath = path.join(dir, "last-message.txt");
  try {
    const streaming = await cliSupportsFlag(input.binary, ["exec", "--help"], "--json", input.cwd);
    const readLine = createLineReader((line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      applyCodexEvent(event, reporter);
      reportCodexActivity(event, input.onActivity);
    });
    const agentic = input.tools === "workspace";
    const result = await spawnCapture(
      input.binary,
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "-s",
        // Writing changesets means writing files; anything else stays read-only.
        agentic ? "workspace-write" : "read-only",
        "--model",
        model,
        "--config",
        `model_reasoning_effort="${agentic ? "medium" : "low"}"`,
        "--output-last-message",
        outputPath,
        ...streaming ? ["--json"] : [],
        "-"
      ],
      {
        cwd: input.cwd,
        stdin: input.prompt,
        signal: input.signal,
        timeoutMs: agentic ? AGENT_TIMEOUT_MS : void 0,
        ...streaming ? { onStdoutChunk: readLine } : { onStdout: (stdout) => reporter.setAnswer(stdout) }
      }
    );
    if (result.cancelled) {
      return { ok: false, code: "cancelled", error: "Cancelled" };
    }
    if (result.timedOut) {
      return { ok: false, code: "timeout", error: result.error ?? "Timed out" };
    }
    let raw = "";
    try {
      raw = await readFile(outputPath, "utf8");
    } catch {
      raw = streaming ? reporter.answerText() : result.stdout;
    }
    if (!raw.trim()) {
      return {
        ok: false,
        code: "empty",
        error: result.error ?? "Codex returned an empty response."
      };
    }
    return { ok: true, text: raw };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => void 0);
  }
}
function reportCodexActivity(event, onActivity) {
  if (!onActivity || !event || typeof event !== "object") return;
  const outer = event;
  const item = outer.item;
  if (item && typeof item === "object") {
    const kind = item.item_type ?? item.type;
    if (!kind) return;
    const status2 = describeToolCall({ name: kind, input: item });
    if (status2) onActivity(status2);
    return;
  }
  const msg = outer.msg && typeof outer.msg === "object" ? outer.msg : outer;
  const type = typeof msg.type === "string" ? msg.type : "";
  if (!type.endsWith("_begin")) return;
  const status = describeToolCall({ name: type.replace(/_begin$/, ""), input: msg });
  if (status) onActivity(status);
}
function applyCodexEvent(event, reporter) {
  if (!event || typeof event !== "object") return;
  const outer = event;
  const item = outer.item;
  if (item && typeof item === "object") {
    const kind = item.item_type ?? item.type;
    const text2 = typeof item.text === "string" ? item.text : void 0;
    if (!text2) return;
    if (kind === "reasoning") reporter.setThinking(text2);
    else if (kind === "agent_message") reporter.setAnswer(text2);
    return;
  }
  const msg = outer.msg && typeof outer.msg === "object" ? outer.msg : outer;
  const type = typeof msg.type === "string" ? msg.type : "";
  const delta = typeof msg.delta === "string" ? msg.delta : "";
  switch (type) {
    case "agent_message_delta":
      reporter.addAnswer(delta);
      return;
    case "agent_reasoning_delta":
    case "agent_reasoning_raw_content_delta":
      reporter.addThinking(delta);
      return;
    case "agent_message":
      if (typeof msg.message === "string") reporter.setAnswer(msg.message);
      return;
    case "agent_reasoning":
      if (typeof msg.text === "string") reporter.setThinking(msg.text);
      return;
    default:
      return;
  }
}
const DEFAULT_MODEL = "claude-haiku-4.5";
async function generateWithCopilot(input) {
  const agentic = input.tools === "workspace";
  const model = input.model?.trim() || DEFAULT_MODEL;
  const reporter = createStreamReporter(input.onProgress);
  const streaming = await cliSupportsFlag(input.binary, ["--help"], "--output-format", input.cwd);
  const readLine = createLineReader((line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    applyCopilotEvent(event, reporter);
    reportCopilotActivity(event, input.onActivity);
  });
  const result = await spawnCapture(
    input.binary,
    [
      "-p",
      input.prompt,
      ...streaming ? ["--output-format", "json"] : ["-s"],
      "--model",
      model,
      "--no-ask-user",
      // Nothing off-machine either way; a workspace run keeps the file and shell
      // tools it needs to look around and write the changesets.
      agentic ? "--deny-tool=url,memory" : "--deny-tool=shell,write,url,memory,read"
    ],
    {
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: agentic ? AGENT_TIMEOUT_MS : void 0,
      ...streaming ? { onStdoutChunk: readLine } : { onStdout: (stdout) => reporter.setAnswer(stdout) }
    }
  );
  reporter.flush();
  if (result.cancelled) {
    return { ok: false, code: "cancelled", error: "Cancelled" };
  }
  if (result.timedOut) {
    return { ok: false, code: "timeout", error: result.error ?? "Timed out" };
  }
  const text2 = streaming ? reporter.answerText().trim() || result.stdout : result.stdout;
  if (!text2.trim()) {
    return {
      ok: false,
      code: result.ok ? "empty" : "failed",
      error: result.error ?? "Copilot returned an empty response."
    };
  }
  return { ok: true, text: text2 };
}
function reportCopilotActivity(event, onActivity) {
  if (!onActivity || !event || typeof event !== "object") return;
  const { type, data } = event;
  if (!type?.startsWith("tool")) return;
  const name = typeof data?.name === "string" ? data.name : type;
  const status = describeToolCall({ name, input: data?.arguments ?? data?.input ?? data });
  if (status) onActivity(status);
}
function applyCopilotEvent(event, reporter) {
  if (!event || typeof event !== "object") return;
  const { type, data } = event;
  if (!type) return;
  const payload = data ?? {};
  const delta = typeof payload.deltaContent === "string" ? payload.deltaContent : "";
  const content = typeof payload.content === "string" ? payload.content : "";
  switch (type) {
    case "assistant.message_delta":
      reporter.addAnswer(delta);
      return;
    case "assistant.message":
      if (content) reporter.setAnswer(content);
      return;
    case "assistant.reasoning_delta":
      reporter.addThinking(delta);
      return;
    case "assistant.reasoning":
      if (content) reporter.setThinking(content);
      return;
    default:
      return;
  }
}
const MODEL = "composer-2.5-fast";
async function generateWithCursor(input) {
  if (input.signal?.aborted) {
    return { ok: false, code: "cancelled", error: "Cancelled" };
  }
  const agentic = input.tools === "workspace";
  const model = input.model?.trim() || MODEL;
  let child;
  try {
    child = spawn(input.binary, ["acp"], {
      cwd: input.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
  } catch (err) {
    return {
      ok: false,
      code: "failed",
      error: err instanceof Error ? err.message : String(err)
    };
  }
  let nextId = 1;
  const pending2 = /* @__PURE__ */ new Map();
  let settled = false;
  const reporter = createStreamReporter(input.onProgress);
  const cleanup = () => {
    try {
      child.kill("SIGTERM");
    } catch {
    }
  };
  const timer = setTimeout(
    () => {
      finish({ ok: false, code: "timeout", error: "Timed out" });
    },
    agentic ? AGENT_TIMEOUT_MS : GENERATION_TIMEOUT_MS
  );
  const finish = (result) => {
    if (settled) return;
    settled = true;
    reporter.flush();
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
    cleanup();
    for (const [, waiter] of pending2) waiter.reject(new Error("Cancelled"));
    pending2.clear();
    settle(result);
  };
  const onAbort = () => {
    finish({ ok: false, code: "cancelled", error: "Cancelled" });
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  let settle = () => void 0;
  const outcome = new Promise((resolve) => {
    settle = resolve;
  });
  const send = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => pending2.set(id, { resolve, reject }));
  };
  const respond = (id, result) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  };
  child.on("error", (err) => {
    finish({ ok: false, code: "failed", error: err.message });
  });
  child.on("close", () => {
    if (!settled) {
      finish({
        ok: false,
        code: input.signal?.aborted ? "cancelled" : "failed",
        error: input.signal?.aborted ? "Cancelled" : "Cursor ACP process exited early."
      });
    }
  });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id != null && (msg.result !== void 0 || msg.error !== void 0)) {
      const waiter = pending2.get(msg.id);
      if (!waiter) return;
      pending2.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message ?? "ACP error"));
      else waiter.resolve(msg.result);
      return;
    }
    if (msg.method === "session/update") {
      const update = msg.params?.update;
      const kind = update?.sessionUpdate;
      if (kind === "tool_call" || kind === "tool_call_update") {
        const status = describeToolCall({
          name: update?.kind ?? update?.title ?? "tool",
          input: update?.rawInput
        }) ?? (typeof update?.title === "string" ? update.title : null);
        if (status) input.onActivity?.(status);
        return;
      }
      const text2 = typeof update?.content?.text === "string" ? update.content.text : void 0;
      if (!text2) return;
      if (kind === "agent_thought_chunk") {
        reporter.addThinking(text2);
        return;
      }
      if (kind === "agent_message_chunk") {
        reporter.addAnswer(text2);
      }
      return;
    }
    if (msg.method === "session/request_permission" && msg.id != null) {
      const options = msg.params?.options ?? [];
      const wanted = agentic ? options.find((o) => o.optionId.includes("allow"))?.optionId ?? "allow-always" : options.find((o) => o.optionId.includes("reject"))?.optionId ?? "reject-once";
      respond(msg.id, { outcome: { outcome: "selected", optionId: wanted } });
      return;
    }
    if (msg.id != null && (msg.method === "cursor/ask_question" || msg.method === "cursor/create_plan")) {
      respond(msg.id, { outcome: { outcome: "cancelled" } });
    }
  });
  try {
    await send("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: { name: "super-review", version: "1.0.0" }
    });
    try {
      await send("authenticate", { methodId: "cursor_login" });
    } catch {
    }
    const session2 = await send("session/new", {
      cwd: input.cwd,
      mcpServers: []
    });
    const sessionId = session2.sessionId;
    try {
      await send("session/set_mode", { sessionId, modeId: agentic ? "agent" : "ask" });
    } catch {
    }
    try {
      await send("session/set_model", { sessionId, modelId: model });
    } catch {
    }
    await send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: input.prompt }]
    });
    const text2 = reporter.answerText();
    if (!text2.trim()) {
      finish({
        ok: false,
        code: "empty",
        error: "Cursor returned an empty response."
      });
    } else {
      finish({ ok: true, text: text2 });
    }
  } catch (err) {
    if (input.signal?.aborted) {
      finish({ ok: false, code: "cancelled", error: "Cancelled" });
    } else {
      finish({
        ok: false,
        code: "failed",
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return outcome;
}
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._+/-]*$/i;
const FAST_RE = /\b(mini|nano|haiku|flash|lite|small|fast|instant|turbo|micro)\b/i;
const SLOW_RE = /\b(opus|pro|ultra|max|reasoning|thinking|o1|o3|o4|r1)\b/i;
const OPENCODE_MODEL_RETRY_LIMIT = 5;
function parseOpenCodeModelsVerbose(stdout) {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  const models = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;
    if (!line || !SLUG_RE.test(line)) continue;
    const slug = line;
    if (i < lines.length && lines[i].trimStart().startsWith("{")) {
      const { json, nextIndex } = readJsonBlock(lines, i);
      i = nextIndex;
      const meta = parseModelMeta(json);
      if (meta?.status === "deprecated") continue;
      models.push({
        slug,
        cost: meta?.cost,
        status: meta?.status
      });
      continue;
    }
    models.push({ slug });
  }
  return dedupeBySlug(models);
}
function rankOpenCodeModels(models) {
  return [...models].sort((a, b) => {
    const costDiff = costScore(a.cost) - costScore(b.cost);
    if (costDiff !== 0) return costDiff;
    const speedDiff = speedScore(a.slug) - speedScore(b.slug);
    if (speedDiff !== 0) return speedDiff;
    return a.slug.localeCompare(b.slug);
  });
}
function selectOpenCodeModelCandidates(models, limit = OPENCODE_MODEL_RETRY_LIMIT) {
  return rankOpenCodeModels(models).slice(0, Math.max(0, limit));
}
async function listOpenCodeModels(binary, cwd) {
  const verbose = await spawnCapture(binary, ["models", "--verbose"], {
    cwd,
    timeoutMs: 3e4
  });
  if (verbose.ok) {
    const parsed = parseOpenCodeModelsVerbose(verbose.stdout);
    if (parsed.length > 0) return parsed;
  }
  const plain = await spawnCapture(binary, ["models"], {
    cwd,
    timeoutMs: 3e4
  });
  if (!plain.ok) {
    const detail = combineCliOutput(plain.stdout, plain.stderr) || plain.error || "";
    throw new Error(detail || "Failed to list OpenCode models");
  }
  return parseOpenCodeModelsVerbose(plain.stdout);
}
function costScore(cost) {
  if (!cost) return Number.POSITIVE_INFINITY;
  const input = Number.isFinite(cost.input) ? cost.input : 0;
  const output = Number.isFinite(cost.output) ? cost.output : 0;
  return input + output;
}
function speedScore(slug) {
  if (FAST_RE.test(slug)) return -1;
  if (SLOW_RE.test(slug)) return 1;
  return 0;
}
function parseModelMeta(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    const cost = parsed.cost && typeof parsed.cost.input === "number" && typeof parsed.cost.output === "number" ? {
      input: parsed.cost.input,
      output: parsed.cost.output,
      ...typeof parsed.cost.cache_read === "number" ? { cache_read: parsed.cost.cache_read } : {},
      ...typeof parsed.cost.cache_write === "number" ? { cache_write: parsed.cost.cache_write } : {}
    } : void 0;
    const status = typeof parsed.status === "string" ? parsed.status : void 0;
    return { cost, status };
  } catch {
    return null;
  }
}
function readJsonBlock(lines, start) {
  const collected = [];
  let depth = 0;
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    collected.push(line);
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (depth <= 0) {
      i += 1;
      break;
    }
  }
  return { json: collected.join("\n"), nextIndex: i };
}
function dedupeBySlug(models) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const model of models) {
    if (seen.has(model.slug)) continue;
    seen.add(model.slug);
    out.push(model);
  }
  return out;
}
const STARTUP_TIMEOUT_MS = 2e4;
async function startOpenCodeServer(binary, cwd, env, signal) {
  const password = randomBytes(24).toString("hex");
  let child;
  try {
    child = spawn(binary, ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
      cwd,
      env: { ...process.env, ...env, OPENCODE_SERVER_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
  } catch {
    return null;
  }
  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    try {
      child.kill("SIGTERM");
    } catch {
    }
    const hard = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
    }, 2e3);
    hard.unref?.();
  };
  const url = await new Promise((resolve) => {
    let output = "";
    let done = false;
    const settle = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.stdout?.resume();
      child.stderr?.resume();
      resolve(value);
    };
    const onData = (chunk) => {
      output += String(chunk);
      const match = output.match(/https?:\/\/[^\s]+/);
      if (match) settle(match[0].trim());
    };
    const onAbort = () => settle(null);
    const timer = setTimeout(() => settle(null), STARTUP_TIMEOUT_MS);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", () => settle(null));
    child.on("exit", () => settle(null));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  if (!url) {
    kill();
    return null;
  }
  return {
    url,
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
    },
    close: kill
  };
}
class OpenCodeStream {
  constructor(server) {
    this.server = server;
  }
  controller = new AbortController();
  sessionID = null;
  order = [];
  parts = /* @__PURE__ */ new Map();
  // The session echoes the prompt back as a user message part, so parts are
  // only rendered once their message is known to be the assistant's.
  roles = /* @__PURE__ */ new Map();
  reporter = null;
  onActivity;
  static async open(server) {
    const stream = new OpenCodeStream(server);
    const started = await stream.connect();
    return started ? stream : null;
  }
  /** Point the stream at a new session/turn. `onActivity` is optional and only
   * meaningful for runs where the agent uses tools. */
  watch(sessionID, reporter, onActivity) {
    this.sessionID = sessionID;
    this.reporter = reporter;
    this.onActivity = onActivity;
    this.order = [];
    this.parts.clear();
    this.roles.clear();
  }
  close() {
    this.controller.abort();
  }
  async connect() {
    let response;
    try {
      response = await fetch(`${this.server.url}/event`, {
        headers: { authorization: this.server.headers.authorization },
        signal: this.controller.signal
      });
    } catch {
      return false;
    }
    if (!response.ok || !response.body) return false;
    void this.pump(response.body);
    return true;
  }
  async pump(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (; ; ) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            this.handle(JSON.parse(line.slice(5).trim()));
          } catch {
          }
        }
      }
    } catch {
    }
  }
  handle(event) {
    if (!event || typeof event !== "object") return;
    const { type, properties } = event;
    if (!type || !properties) return;
    if (!this.sessionID || properties.sessionID !== this.sessionID) return;
    if (type === "message.updated") {
      const info = properties.info;
      if (typeof info?.id === "string" && typeof info.role === "string") {
        this.roles.set(info.id, info.role);
        this.render();
      }
      return;
    }
    if (type === "message.part.updated") {
      const part = properties.part;
      if (!part?.id || !part.messageID) return;
      if (part.type === "tool" && typeof part.tool === "string" && this.onActivity) {
        const status = describeToolCall({ name: part.tool, input: part.state?.input });
        if (status) this.onActivity(status);
      }
      if (!this.parts.has(part.id)) this.order.push(part.id);
      this.parts.set(part.id, {
        type: part.type ?? "text",
        messageID: part.messageID,
        text: typeof part.text === "string" ? part.text : ""
      });
      this.render();
      return;
    }
    if (type === "message.part.delta") {
      const { partID, field, delta } = properties;
      if (!partID || field !== "text" || typeof delta !== "string") return;
      const part = this.parts.get(partID);
      if (!part) return;
      part.text += delta;
      this.render();
    }
  }
  render() {
    if (!this.reporter) return;
    const thinking = [];
    const answer = [];
    for (const id of this.order) {
      const part = this.parts.get(id);
      if (!part?.text) continue;
      if (this.roles.get(part.messageID) !== "assistant") continue;
      if (part.type === "reasoning") thinking.push(part.text);
      else if (part.type === "text") answer.push(part.text);
    }
    this.reporter.setThinking(thinking.join("\n\n"));
    this.reporter.setAnswer(answer.join("\n\n"));
  }
}
async function createOpenCodeSession(server) {
  try {
    const response = await fetch(`${server.url}/session`, {
      method: "POST",
      headers: server.headers,
      body: JSON.stringify({ title: "Commit message" })
    });
    if (!response.ok) return null;
    const session2 = await response.json();
    return typeof session2.id === "string" ? session2.id : null;
  } catch {
    return null;
  }
}
async function sendOpenCodeMessage(server, sessionID, model, prompt, timeoutMs, signal) {
  const slash = model.indexOf("/");
  if (slash <= 0) return { ok: false, error: `Invalid model \`${model}\`` };
  const providerID = model.slice(0, slash);
  const modelID = model.slice(slash + 1);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(`${server.url}/session/${sessionID}/message`, {
      method: "POST",
      headers: server.headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: { providerID, modelID },
        parts: [{ type: "text", text: prompt }]
      })
    });
    const raw = await response.text();
    if (!response.ok) return { ok: false, error: raw };
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return { ok: false, error: raw };
    }
    if (message.info?.error) {
      return { ok: false, error: JSON.stringify(message.info.error) };
    }
    const text2 = (message.parts ?? []).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n");
    return { ok: true, text: text2 };
  } catch (err) {
    if (timedOut) return { ok: false, timedOut: true, error: "Timed out" };
    if (signal?.aborted) return { ok: false, cancelled: true, error: "Cancelled" };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
async function generateWithOpenCode(input) {
  let models;
  try {
    models = await listOpenCodeModels(input.binary, input.cwd);
  } catch (err) {
    return {
      ok: false,
      code: "failed",
      error: explainOpenCodeNoModels(err instanceof Error ? err.message : String(err))
    };
  }
  if (models.length === 0) {
    return {
      ok: false,
      code: "failed",
      error: explainOpenCodeNoModels()
    };
  }
  const candidates = selectOpenCodeModelCandidates(models);
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "failed",
      error: explainOpenCodeNoModels()
    };
  }
  const agentic = input.tools === "workspace";
  const dir = await mkdtemp(path.join(tmpdir(), "sr-opencode-"));
  const configPath = path.join(dir, "opencode.json");
  const reporter = createStreamReporter(input.onProgress);
  let server = null;
  let stream = null;
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        permission: agentic ? {
          "*": "allow",
          bash: "allow",
          edit: "allow",
          write: "allow",
          read: "allow",
          webfetch: "deny",
          websearch: "deny",
          question: "deny",
          external_directory: "deny"
        } : {
          "*": "deny",
          bash: "deny",
          edit: "deny",
          write: "deny",
          read: "deny",
          webfetch: "deny",
          websearch: "deny",
          question: "deny",
          external_directory: "deny"
        }
      }),
      "utf8"
    );
    const tried = [];
    let lastFailure = null;
    const preferred = input.model?.trim();
    const ordered = preferred ? [{ slug: preferred }, ...candidates.filter((c) => c.slug !== preferred)] : candidates;
    server = await startOpenCodeServer(
      input.binary,
      input.cwd,
      { OPENCODE_CONFIG: configPath },
      input.signal
    );
    stream = server ? await OpenCodeStream.open(server) : null;
    if (server && !stream) {
      server.close();
      server = null;
    }
    for (const candidate of ordered) {
      if (input.signal?.aborted) {
        return { ok: false, code: "cancelled", error: "Cancelled" };
      }
      tried.push(candidate.slug);
      reporter.reset();
      let attempt;
      if (server && stream) {
        attempt = await runOnServer(server, stream, candidate.slug, input, reporter);
        if (attempt.serverUnavailable) {
          stream.close();
          server.close();
          stream = null;
          server = null;
          attempt = await runOneShot(configPath, candidate.slug, input, reporter);
        }
      } else {
        attempt = await runOneShot(configPath, candidate.slug, input, reporter);
      }
      if (attempt.cancelled) {
        return { ok: false, code: "cancelled", error: "Cancelled" };
      }
      if (attempt.timedOut) {
        return { ok: false, code: "timeout", error: attempt.error ?? "Timed out" };
      }
      if (attempt.text.trim()) {
        return { ok: true, text: attempt.text };
      }
      const failure = {
        ok: false,
        code: attempt.ok ? "empty" : "failed",
        error: explainOpenCodeFailure(attempt.error ?? "", {
          model: candidate.slug,
          modelCount: models.length,
          triedModels: tried
        })
      };
      lastFailure = failure;
      if (attempt.ok) return failure;
      if (!isRetryableOpenCodeModelFailure(attempt.error ?? "")) {
        return failure;
      }
    }
    return lastFailure ?? {
      ok: false,
      code: "failed",
      error: explainOpenCodeNoModels()
    };
  } finally {
    reporter.flush();
    stream?.close();
    server?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => void 0);
  }
}
async function runOnServer(server, stream, model, input, reporter) {
  const sessionID = await createOpenCodeSession(server);
  if (!sessionID) return { ok: false, text: "", serverUnavailable: true };
  stream.watch(sessionID, reporter, input.onActivity);
  const reply = await sendOpenCodeMessage(
    server,
    sessionID,
    model,
    input.prompt,
    input.tools === "workspace" ? AGENT_TIMEOUT_MS : GENERATION_TIMEOUT_MS,
    input.signal
  );
  return {
    ok: reply.ok,
    text: reply.text ?? "",
    error: reply.error,
    cancelled: reply.cancelled,
    timedOut: reply.timedOut
  };
}
async function runOneShot(configPath, model, input, reporter) {
  const result = await spawnCapture(
    input.binary,
    ["run", "--model", model, "--format", "default", input.prompt],
    {
      cwd: input.cwd,
      env: { OPENCODE_CONFIG: configPath },
      signal: input.signal,
      timeoutMs: input.tools === "workspace" ? AGENT_TIMEOUT_MS : void 0,
      onStdout: (stdout) => reporter.setAnswer(stdout)
    }
  );
  return {
    ok: result.ok,
    text: result.stdout,
    error: combineCliOutput(result.stdout, result.stderr) || result.error || "",
    cancelled: result.cancelled,
    timedOut: result.timedOut
  };
}
async function runAdapter(harness, input) {
  return classifyAuthFailure(harness, await runHarness(harness, input));
}
function runHarness(harness, input) {
  switch (harness) {
    case "codex":
      return generateWithCodex(input);
    case "claude-code":
      return generateWithClaude(input);
    case "cursor":
      return generateWithCursor(input);
    case "copilot":
      return generateWithCopilot(input);
    case "opencode":
      return generateWithOpenCode(input);
  }
}
function classifyAuthFailure(harness, result) {
  if (result.ok || result.code === "cancelled") return result;
  if (!looksLikeAuthFailure(result.error)) return result;
  return { ...result, code: "auth", error: explainAuthFailure(harness, result.error) };
}
function parseCommitMessageOutput(raw) {
  const text2 = unwrapFence(stripAnsi(raw).trim());
  if (!text2) return null;
  return parseJsonShape(text2) ?? parsePlainMessage(text2);
}
function sanitizeSubject(subject) {
  let s = subject.trim().replace(/\s+/g, " ");
  s = s.replace(/^(?:subject|title|commit(?:\s+message)?)\s*:\s*/i, "");
  if (s.startsWith('"') && s.endsWith('"') || s.startsWith("'") && s.endsWith("'")) {
    s = s.slice(1, -1).trim();
  }
  while (s.endsWith(".")) s = s.slice(0, -1).trimEnd();
  if (s.length > 72) s = s.slice(0, 72).trimEnd();
  return s;
}
function parsePlainMessage(text2) {
  const lines = text2.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) return null;
  const subject = sanitizeSubject(lines[i]);
  if (!subject) return null;
  const body = lines.slice(i + 1).join("\n").replace(/^\s*(?:body|description)\s*:\s*/i, "").trim();
  return { subject, body };
}
function parseJsonShape(text2) {
  if (!text2.startsWith("{")) return null;
  const end = text2.lastIndexOf("}");
  if (end <= 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(text2.slice(0, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed;
  const subjectRaw = typeof obj.subject === "string" ? obj.subject : null;
  if (!subjectRaw) return null;
  const subject = sanitizeSubject(subjectRaw);
  if (!subject) return null;
  const body = typeof obj.body === "string" ? obj.body.trim() : "";
  return { subject, body };
}
function unwrapFence(text2) {
  if (!text2.startsWith("```")) return text2;
  const match = text2.match(/^```[^\n]*\n([\s\S]*?)```\s*$/);
  return match ? match[1].trim() : text2;
}
const DEFAULT_COMMIT_MESSAGE_BASE_PROMPT = `Write a *concise* conventional commit message for this set of changes.
If there are multiple changes, list them as bullets in the body of the commit message and do your best to either:
1. summarize the changes into a single sentence for a commit title
2. if all the changes relate to one feature use that feature as the headline`;
const SUMMARY_LIMIT = 6e3;
const PATCH_LIMIT = 4e4;
const OUTPUT_FORMAT_SECTION = [
  "Reply with the commit message itself and nothing else:",
  "- first line: the subject, at most 72 characters, no trailing period",
  "- then one blank line, then the body (leave it out when the subject says it all)",
  'No code fences, no "Subject:"/"Body:" labels, no commentary around it.'
].join("\n");
function buildCommitMessagePrompt(input) {
  const base = input.basePrompt?.trim() || DEFAULT_COMMIT_MESSAGE_BASE_PROMPT;
  return [
    base,
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    "",
    "Staged files:",
    limitSection(input.fileSummary, SUMMARY_LIMIT),
    "",
    "Staged patch:",
    limitSection(input.patch, PATCH_LIMIT),
    "",
    OUTPUT_FORMAT_SECTION
  ].join("\n");
}
function summarizeSelections(selections) {
  if (selections.length === 0) return "(none)";
  return selections.map((s) => s.oldPath && s.oldPath !== s.path ? `${s.oldPath} -> ${s.path}` : s.path).join("\n");
}
function concatenatePatches(selections) {
  const parts = [];
  for (const s of selections) {
    const patch = s.patch?.trim();
    if (!patch) {
      parts.push(`--- a/${s.path}
+++ b/${s.path}
(no patch available; file included as-is)`);
      continue;
    }
    parts.push(patch);
  }
  return parts.join("\n\n");
}
function limitSection(text2, limit) {
  if (text2.length <= limit) return text2 || "(empty)";
  return `${text2.slice(0, limit)}

…(truncated)`;
}
const DEFAULT_COMMIT_MESSAGE_MODELS = {
  cursor: "composer-2.5-fast",
  "claude-code": "haiku",
  codex: "gpt-5.6-luna",
  copilot: "claude-haiku-4.5",
  opencode: ""
};
function resolveCommitMessageModel(harness, preferred) {
  const trimmed = preferred?.trim();
  if (trimmed) return trimmed;
  return DEFAULT_COMMIT_MESSAGE_MODELS[harness];
}
let activeAbort$1 = null;
function cancelCommitMessageGeneration() {
  if (!activeAbort$1) return false;
  activeAbort$1.abort();
  activeAbort$1 = null;
  return true;
}
async function generateCommitMessage(repoPath, request, options) {
  if (!request.selections.length) {
    return { ok: false, code: "failed", error: "No files selected for the commit." };
  }
  cancelCommitMessageGeneration();
  const abort = new AbortController();
  activeAbort$1 = abort;
  try {
    const resolved = await resolveHarnessForRun(request.preferredHarness);
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.code,
        error: resolved.error,
        ...resolved.code === "auth" ? { harness: resolved.harness } : {}
      };
    }
    const { harness, binary } = resolved;
    if (abort.signal.aborted) {
      return { ok: false, harness, code: "cancelled", error: "Cancelled" };
    }
    const selections = await ensurePatches(repoPath, request.selections);
    const prompt = buildCommitMessagePrompt({
      branch: request.branch,
      fileSummary: summarizeSelections(selections),
      patch: concatenatePatches(selections),
      basePrompt: request.basePrompt
    });
    const model = resolveCommitMessageModel(harness, request.model);
    const input = {
      binary,
      cwd: repoPath,
      prompt,
      model: model || void 0,
      signal: abort.signal,
      onProgress: options?.onProgress
    };
    let result;
    try {
      result = await runAdapter(harness, input);
    } catch (err) {
      if (abort.signal.aborted) {
        return { ok: false, harness, code: "cancelled", error: "Cancelled" };
      }
      return {
        ok: false,
        harness,
        code: "failed",
        error: err instanceof Error ? err.message : String(err)
      };
    }
    if (!result.ok) {
      return {
        ok: false,
        harness,
        code: result.code ?? "failed",
        error: result.error ?? "Failed to generate a commit message."
      };
    }
    const parsed = parseCommitMessageOutput(result.text ?? "");
    if (!parsed) {
      return {
        ok: false,
        harness,
        code: "empty",
        error: "The agent returned no usable commit message."
      };
    }
    return {
      ok: true,
      harness,
      subject: parsed.subject,
      body: parsed.body
    };
  } finally {
    if (activeAbort$1 === abort) activeAbort$1 = null;
  }
}
async function ensurePatches(repoPath, selections) {
  const out = [];
  for (const s of selections) {
    if (s.patch?.trim()) {
      out.push(s);
      continue;
    }
    try {
      const diff = await getDiff(repoPath, s.path, { kind: "workingTree" });
      out.push({
        ...s,
        patch: diff.patch || void 0
      });
    } catch {
      out.push(s);
    }
  }
  return out;
}
const DEFAULT_CHANGESET_BASE_PROMPT = `Describe the branch by what it adds to the release, not by how it was built. A changelog reader has never seen this branch's commits: to them the whole branch arrives at once, so a commit that fixes or extends something this same branch introduced is part of that feature, not a fix to it. Fold it in. Only work that changes something which already existed before the branch is a fix or a change of its own.

Write one changeset per distinct piece of work that leaves, each scoped to the packages that piece actually touched. Two unrelated features are two changesets; one feature spread across five packages, five commits, and a follow-up fix is still one changeset.

Each summary is a single line in the style of a conventional commit: \`type(scope): what changed\`. No body, no bullet list, no detail below it.`;
function buildChangesetPrompt(input) {
  const { brief } = input;
  const style = input.basePrompt?.trim() || DEFAULT_CHANGESET_BASE_PROMPT;
  const base = brief.mergeBase ?? brief.baseRef;
  return [
    "Write the changesets for the work on this branch. You are running inside the repository.",
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    base ? `Base: ${brief.baseRef ?? "the default branch"} (this branch starts at ${base})` : "Base: none found — treat the working tree as the change.",
    "",
    "Releasable packages, the only names a changeset may reference:",
    describePackages(brief),
    "",
    "Changesets already on this branch:",
    describeExisting(brief),
    "",
    "Still uncovered — these packages have changes on this branch that no changeset accounts for yet:",
    brief.uncoveredPackages.length ? brief.uncoveredPackages.join("\n") : "(none)",
    "The job is done when every one of them is covered. Find what changed in each and give it a changeset; a package with a real change in it never gets left out, however small the change looks.",
    "",
    "Work out what changed for yourself, and take the time to do it properly.",
    base ? `Everything since ${base} is in scope, committed or not. Committed work and uncommitted work are equally part of this branch, and they are often different features — read the commit log, the diff against the base, and the uncommitted and untracked files as three separate passes, and open whatever files you need to understand what each one actually does.` : "The working tree is the change: read the diff and the untracked files, and open whatever files you need to understand what the change actually does.",
    "Before writing anything, list for yourself every distinct piece of work you found and which packages each one touched. A branch often carries more than one, and the ones that matter are not always the ones with the most lines. Then write the changesets from that list.",
    "",
    "How to write them:",
    style,
    "",
    "Then write the files yourself, one per changeset, as `.changeset/<a-slug-like-this>.md`:",
    "---",
    "'<package>': patch | minor | major",
    "---",
    "",
    "<summary>",
    "",
    "Rules:",
    "- Every piece of work on the branch that no listed changeset already covers needs one. Work committed earlier on the branch counts exactly as much as what is sitting uncommitted right now — neither is more done than the other, and both ship in the same release.",
    "- Create and edit files inside `.changeset/` only. Change nothing else in the repository, and do not commit, stage, or run git commands that write.",
    "- Only reference packages from the list above, and only ones this branch actually changed.",
    "- Leave the changesets already listed above alone; write only what they do not cover.",
    "- Give each changeset its own file with a fresh slug; do not overwrite an existing one.",
    "",
    "Before you finish, check two things: every piece of work on your list has a changeset, and every package listed as uncovered above is named in one of them.",
    "When you are done, reply with one line naming the files you wrote. Nothing else."
  ].join("\n");
}
function describePackages(brief) {
  if (brief.packages.length === 0) return "(none)";
  return brief.packages.map((p) => `${p.name} (${p.dir || "."})${p.private ? " [private]" : ""}`).join("\n");
}
function describeExisting(brief) {
  if (brief.branchChangesets.length === 0) return "(none)";
  return brief.branchChangesets.map((c) => `${c.path} covers ${c.packages.join(", ") || "(nothing)"}`).join("\n");
}
async function listDirtyPaths(repoPath) {
  const paths = /* @__PURE__ */ new Set();
  try {
    const status = await simpleGit(repoPath).raw(["status", "--porcelain", "-z"]);
    for (const entry of status.split("\0")) {
      if (entry.length > 3) paths.add(entry.slice(3));
    }
  } catch {
  }
  return paths;
}
let activeAbort = null;
function cancelChangesetGeneration() {
  if (!activeAbort) return false;
  activeAbort.abort();
  activeAbort = null;
  return true;
}
async function generateChangeset(repoPath, request, options) {
  cancelChangesetGeneration();
  const abort = new AbortController();
  activeAbort = abort;
  try {
    const brief = await getChangesetBrief(repoPath);
    if (!brief) {
      return {
        ok: false,
        code: "not-installed",
        error: "This repository does not use changesets."
      };
    }
    if (brief.packages.length === 0) {
      return {
        ok: false,
        code: "failed",
        error: "No releasable packages found in this workspace."
      };
    }
    const resolved = await resolveHarnessForRun(request.preferredHarness);
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.code,
        error: resolved.error,
        ...resolved.code === "auth" ? { harness: resolved.harness } : {}
      };
    }
    const { harness, binary } = resolved;
    if (abort.signal.aborted) {
      return { ok: false, harness, code: "cancelled", error: "Cancelled" };
    }
    const [before, dirtyBefore] = await Promise.all([
      readChangesetFiles(repoPath),
      listDirtyPaths(repoPath)
    ]);
    const input = {
      binary,
      cwd: repoPath,
      prompt: buildChangesetPrompt({
        branch: request.branch,
        brief,
        basePrompt: request.basePrompt
      }),
      // Only the user's own choice. Left unset, the adapter picks the model for
      // the job — the cheap tier that writes a commit message from a patch that
      // is already in the prompt is not the tier that can read a branch and
      // decide what it adds up to.
      model: request.model?.trim() || void 0,
      tools: "workspace",
      signal: abort.signal,
      onActivity: options?.onActivity ? (status) => options.onActivity?.(clampStatus(status)) : void 0
    };
    let result;
    try {
      result = await runAdapter(harness, input);
    } catch (err) {
      if (abort.signal.aborted) {
        return { ok: false, harness, code: "cancelled", error: "Cancelled" };
      }
      return {
        ok: false,
        harness,
        code: "failed",
        error: err instanceof Error ? err.message : String(err)
      };
    }
    if (abort.signal.aborted) {
      return { ok: false, harness, code: "cancelled", error: "Cancelled" };
    }
    const [after, dirtyAfter] = await Promise.all([
      readChangesetFiles(repoPath),
      listDirtyPaths(repoPath)
    ]);
    const written = changesetFilesWritten(before, after);
    if (written.length === 0) {
      if (!result.ok) {
        return {
          ok: false,
          harness,
          code: result.code ?? "failed",
          error: result.error ?? "Failed to generate a changeset."
        };
      }
      return {
        ok: false,
        harness,
        code: "empty",
        error: "The agent finished without writing a changeset."
      };
    }
    const releasable = new Set(brief.packages.map((p) => p.name));
    const unknownPackages = [
      ...new Set(written.flatMap((f) => f.packages).filter((name) => !releasable.has(name)))
    ];
    const stray = strayPaths(dirtyBefore, dirtyAfter);
    return {
      ok: true,
      harness,
      written: written.map(toGeneratedFile),
      ...unknownPackages.length ? { unknownPackages } : {},
      ...stray.length ? { strayPaths: stray } : {}
    };
  } finally {
    if (activeAbort === abort) activeAbort = null;
  }
}
function toGeneratedFile(file) {
  return { path: file.path, packages: file.packages, summary: firstLineOfBody(file.contents) };
}
function firstLineOfBody(contents) {
  const body = contents.replace(/^---[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
function strayPaths(before, after) {
  const stray = [];
  for (const path2 of after) {
    if (before.has(path2)) continue;
    if (path2.startsWith(".changeset/")) continue;
    stray.push(path2);
  }
  return stray.sort();
}
const CLAUDE_FAMILIES = /* @__PURE__ */ new Set(["fable", "mythos", "opus", "sonnet", "haiku"]);
function formatClaudeModelLabel(id) {
  const parts = id.trim().replace(/\[[^\]]*\]$/, "").split("-");
  if (parts.shift() !== "claude") return null;
  const family = parts.shift();
  if (!family || !CLAUDE_FAMILIES.has(family)) return null;
  if (parts.length > 1 && /^\d{8}$/.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0 || !parts.every((part) => /^\d+$/.test(part))) return null;
  return `${family[0].toUpperCase()}${family.slice(1)} ${parts.join(".")}`;
}
const CLAUDE_TIERS = [
  { alias: "haiku", label: "Haiku" },
  { alias: "sonnet", label: "Sonnet" },
  { alias: "opus", label: "Opus" },
  { alias: "fable", label: "Fable" }
];
const CURATED = {
  cursor: [
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
    { id: "composer-2.5", label: "Composer 2.5" },
    { id: "composer-2", label: "Composer 2" },
    { id: "auto", label: "Auto" }
  ],
  "claude-code": CLAUDE_TIERS.map((tier) => ({ id: tier.alias, label: tier.label })),
  codex: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.3-codex", label: "Codex 5.3" },
    { id: "gpt-5.3-codex-fast", label: "Codex 5.3 Fast" }
  ],
  copilot: [
    { id: "claude-haiku-4.5", label: "Haiku 4.5" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-5-mini", label: "GPT-5 mini" }
  ],
  opencode: []
};
const REVALIDATE_AFTER_MS = 6 * 60 * 60 * 1e3;
const MODEL_LIST_VERSION = 3;
const cache = /* @__PURE__ */ new Map();
const inflight = /* @__PURE__ */ new Map();
function readCache(harness) {
  const hit = cache.get(harness);
  if (hit) return hit;
  const stored = getCachedCommitMessageModels(harness, MODEL_LIST_VERSION);
  if (stored) cache.set(harness, stored);
  return stored;
}
function refresh(harness) {
  const pending2 = inflight.get(harness);
  if (pending2) return pending2;
  const load = (async () => {
    try {
      const listed = await loadModels(harness);
      if (listed && listed.length > 0) {
        const fetchedAt = Date.now();
        cache.set(harness, { models: listed, fetchedAt });
        setCachedCommitMessageModels(harness, listed, fetchedAt, MODEL_LIST_VERSION);
        return listed;
      }
      const fallback = CURATED[harness];
      if (fallback.length > 0 && !cache.has(harness)) {
        cache.set(harness, { models: fallback, fetchedAt: 0 });
      }
      return listed;
    } finally {
      inflight.delete(harness);
    }
  })();
  inflight.set(harness, load);
  return load;
}
async function listCommitMessageModels(harness) {
  const hit = readCache(harness);
  if (hit) {
    if (Date.now() - hit.fetchedAt > REVALIDATE_AFTER_MS) void refresh(harness);
    return hit.models;
  }
  return await refresh(harness) ?? CURATED[harness];
}
async function warmCommitMessageModels(status) {
  const installed2 = status ?? await detectCommitMessageHarnesses();
  for (const harness of COMMIT_MESSAGE_HARNESS_PRIORITY) {
    if (!installed2[harness]?.installed) continue;
    const hit = readCache(harness);
    if (hit && Date.now() - hit.fetchedAt <= REVALIDATE_AFTER_MS) continue;
    try {
      await refresh(harness);
    } catch {
    }
  }
}
async function loadModels(harness) {
  if (harness === "codex" || harness === "copilot") {
    return CURATED[harness];
  }
  const binary = await resolveHarnessBinary(harness);
  if (!binary) return null;
  try {
    if (harness === "cursor") {
      return await listCursorModels(binary);
    }
    if (harness === "claude-code") {
      return await listClaudeModels(binary);
    }
    const listed = rankOpenCodeModels(await listOpenCodeModels(binary, process.cwd()));
    return listed.length > 0 ? listed.map((m) => ({ id: m.slug, label: m.slug })) : null;
  } catch {
    return null;
  }
}
async function listClaudeModels(binary) {
  const resolved = await Promise.all(
    CLAUDE_TIERS.map((tier) => resolveClaudeTierModel(binary, tier.alias))
  );
  const models = CLAUDE_TIERS.map((tier, i) => {
    const id = resolved[i];
    return { id: tier.alias, label: id && formatClaudeModelLabel(id) || tier.label };
  });
  return resolved.some((id) => id !== null) ? models : null;
}
async function resolveClaudeTierModel(binary, alias) {
  const controller = new AbortController();
  const state = { model: null };
  const readLine = createLineReader((line) => {
    if (state.model) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type !== "system" || event.subtype !== "init") return;
    if (typeof event.model !== "string" || !event.model) return;
    state.model = event.model;
    controller.abort();
  });
  await spawnCapture(
    binary,
    ["-p", "--output-format", "stream-json", "--verbose", "--model", alias],
    {
      cwd: process.cwd(),
      // Never read: the run is killed at the init event.
      stdin: ".",
      timeoutMs: 2e4,
      signal: controller.signal,
      env: { PATH: augmentedPath() },
      onStdoutChunk: readLine
    }
  );
  return state.model;
}
async function listCursorModels(binary) {
  const result = await spawnCapture(binary, ["models"], {
    cwd: process.cwd(),
    timeoutMs: 3e4,
    env: {
      PATH: augmentedPath()
    }
  });
  const raw = stripAnsi(`${result.stdout}
${result.stderr}`);
  const models = parseCursorModelsOutput(raw);
  return models.length > 0 ? models : null;
}
function parseCursorModelsOutput(raw) {
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^available models$/i.test(trimmed)) continue;
    if (/^tip:/i.test(trimmed)) continue;
    const match = /^([a-z0-9][a-z0-9._+/-]*)\s+-\s+(.+)$/i.exec(trimmed);
    if (!match) continue;
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const label = match[2].replace(/\s+\(.*\)\s*$/, "").trim();
    if (!label) continue;
    models.push({ id, label });
  }
  return models;
}
function repoOrThrow(id) {
  const repo = getRepo(id);
  if (!repo) throw new Error(`Repo not found: ${id}`);
  return repo;
}
const ICON_MIME_BY_EXT = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".avif": "image/avif"
};
const MAX_ICON_BYTES = 2 * 1024 * 1024;
async function resolveCustomIcon(rawSource) {
  const source = (rawSource ?? "").trim();
  if (!source) return null;
  if (source.startsWith("https://") || source.startsWith("data:")) return source;
  let filePath = source;
  if (filePath.startsWith("file://")) {
    try {
      filePath = decodeURI(new URL(filePath).pathname);
    } catch {
      return null;
    }
  }
  if (!path.isAbsolute(filePath)) return null;
  const mime = ICON_MIME_BY_EXT[path.extname(filePath).toLowerCase()];
  if (!mime) return null;
  try {
    const bytes = await readFile(filePath);
    if (bytes.byteLength > MAX_ICON_BYTES) return null;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
function repoFetchUrl(repo, owner, name) {
  const { remoteUrl, githubOwner, githubRepo } = repo;
  if (remoteUrl && githubOwner && githubRepo) {
    const swapped = remoteUrl.replace(`${githubOwner}/${githubRepo}`, `${owner}/${name}`);
    if (swapped !== remoteUrl) return swapped;
  }
  return `https://github.com/${owner}/${name}.git`;
}
function upstreamFetchUrl(repo) {
  return repoFetchUrl(repo, repo.upstreamOwner ?? "", repo.upstreamRepo ?? "");
}
function sendToWindow(win, channel, payload) {
  if (win.isDestroyed()) return;
  const wc = win.webContents;
  if (wc.isDestroyed() || wc.isCrashed()) return;
  try {
    wc.send(channel, payload);
  } catch {
  }
}
function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWindow(win, channel, payload);
  }
}
function broadcastToOthers(senderId, channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.id === senderId) continue;
    sendToWindow(win, channel, payload);
  }
}
const sessionWatchers = /* @__PURE__ */ new Map();
const sessionWatchByContents = /* @__PURE__ */ new Map();
const sessionWatchHooked = /* @__PURE__ */ new Set();
function releaseSessionWatch(repoPath) {
  const entry = sessionWatchers.get(repoPath);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.close();
    sessionWatchers.delete(repoPath);
  }
}
function setSessionWatch(sender, repoId) {
  const repo = getRepo(repoId);
  if (!repo) return;
  const prev = sessionWatchByContents.get(sender.id);
  if (prev === repo.path) return;
  if (prev) releaseSessionWatch(prev);
  sessionWatchByContents.set(sender.id, repo.path);
  const entry = sessionWatchers.get(repo.path);
  if (entry) {
    entry.refs += 1;
  } else {
    const close = watchSessionsDir(repo.path, () => broadcast("sessions:changed", repoId));
    sessionWatchers.set(repo.path, { close, refs: 1 });
  }
  if (!sessionWatchHooked.has(sender.id)) {
    sessionWatchHooked.add(sender.id);
    sender.once("destroyed", () => clearSessionWatch(sender.id));
  }
}
function clearSessionWatch(senderId) {
  const prev = sessionWatchByContents.get(senderId);
  if (prev) releaseSessionWatch(prev);
  sessionWatchByContents.delete(senderId);
  sessionWatchHooked.delete(senderId);
}
const commentWatchers = /* @__PURE__ */ new Map();
const commentWatchByContents = /* @__PURE__ */ new Map();
const commentWatchHooked = /* @__PURE__ */ new Set();
function releaseCommentWatch(repoPath) {
  const entry = commentWatchers.get(repoPath);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.close();
    commentWatchers.delete(repoPath);
  }
}
function setCommentWatch(sender, repoId) {
  const repo = getRepo(repoId);
  if (!repo) return;
  const prev = commentWatchByContents.get(sender.id);
  if (prev === repo.path) return;
  if (prev) releaseCommentWatch(prev);
  commentWatchByContents.set(sender.id, repo.path);
  const entry = commentWatchers.get(repo.path);
  if (entry) {
    entry.refs += 1;
  } else {
    const close = watchCommentsDir(repo.path, () => broadcast("comments:changed", repoId));
    commentWatchers.set(repo.path, { close, refs: 1 });
  }
  if (!commentWatchHooked.has(sender.id)) {
    commentWatchHooked.add(sender.id);
    sender.once("destroyed", () => clearCommentWatch(sender.id));
  }
}
function clearCommentWatch(senderId) {
  const prev = commentWatchByContents.get(senderId);
  if (prev) releaseCommentWatch(prev);
  commentWatchByContents.delete(senderId);
  commentWatchHooked.delete(senderId);
}
const taskWatchers = /* @__PURE__ */ new Map();
const taskWatchByContents = /* @__PURE__ */ new Map();
const taskWatchHooked = /* @__PURE__ */ new Set();
function releaseTaskWatch(repoPath) {
  const entry = taskWatchers.get(repoPath);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.close();
    taskWatchers.delete(repoPath);
  }
}
function setTaskWatch(sender, repoId) {
  const repo = getRepo(repoId);
  if (!repo) return;
  const prev = taskWatchByContents.get(sender.id);
  if (prev === repo.path) return;
  if (prev) releaseTaskWatch(prev);
  taskWatchByContents.set(sender.id, repo.path);
  const entry = taskWatchers.get(repo.path);
  if (entry) {
    entry.refs += 1;
  } else {
    const close = watchTasksDir(repo.path, () => broadcast("tasks:changed", repoId));
    taskWatchers.set(repo.path, { close, refs: 1 });
  }
  if (!taskWatchHooked.has(sender.id)) {
    taskWatchHooked.add(sender.id);
    sender.once("destroyed", () => clearTaskWatch(sender.id));
  }
}
function clearTaskWatch(senderId) {
  const prev = taskWatchByContents.get(senderId);
  if (prev) releaseTaskWatch(prev);
  taskWatchByContents.delete(senderId);
  taskWatchHooked.delete(senderId);
}
function preservePinnedAccount(info) {
  const existing = getRepo(info.id);
  return existing?.githubAccountId ? { ...info, githubAccountId: existing.githubAccountId } : info;
}
async function refreshRepoInfoInBackground(repoPath, previous) {
  try {
    const fresh = await buildRepoInfo(repoPath);
    const merged = {
      ...fresh,
      lastOpenedAt: previous.lastOpenedAt,
      githubAccountId: previous.githubAccountId
    };
    const changed = merged.iconDataUrl !== previous.iconDataUrl || merged.iconDataUrlDark !== previous.iconDataUrlDark || merged.remoteUrl !== previous.remoteUrl || merged.defaultBranch !== previous.defaultBranch || merged.githubOwner !== previous.githubOwner || merged.githubRepo !== previous.githubRepo || merged.description !== previous.description || merged.name !== previous.name;
    if (!changed) return;
    upsertRepo(merged);
    broadcast("repos:active-changed", merged);
  } catch {
  }
}
function registerIpc() {
  registerLicenseIpc();
  ipcMain.handle("repos:list", async () => listRepos());
  ipcMain.handle("repos:openPicker", async (e) => {
    const result = await dialog.showOpenDialog({
      title: "Open repository",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const repoPath = result.filePaths[0];
    if (!await isGitRepo(repoPath)) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
    const info = preservePinnedAccount(await buildRepoInfo(repoPath));
    upsertRepo(info);
    setPrefs({ activeRepoId: info.id });
    broadcastToOthers(e.sender.id, "repos:active-changed", info);
    return info;
  });
  ipcMain.handle("repos:openFolder", async (e) => {
    const result = await dialog.showOpenDialog({
      title: "Open folder",
      buttonLabel: "Scan folder",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const root = result.filePaths[0];
    const repoPaths = await scanForRepos(root);
    if (repoPaths.length === 0) {
      throw new Error(`No git repositories found in: ${root}`);
    }
    const infos = await Promise.all(
      repoPaths.map(async (p) => preservePinnedAccount(await buildRepoInfo(p)))
    );
    for (const info of infos) upsertRepo(info);
    infos.sort((a, b) => a.name.localeCompare(b.name));
    const active = infos[0];
    setPrefs({ activeRepoId: active.id });
    broadcastToOthers(e.sender.id, "repos:active-changed", active);
    return infos;
  });
  ipcMain.handle("repos:addByPath", async (e, repoPath) => {
    if (!await isGitRepo(repoPath)) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
    const info = preservePinnedAccount(await buildRepoInfo(repoPath));
    upsertRepo(info);
    setPrefs({ activeRepoId: info.id });
    broadcastToOthers(e.sender.id, "repos:active-changed", info);
    return info;
  });
  ipcMain.handle("repos:chooseDirectory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a folder",
      buttonLabel: "Select",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("repos:isGitRepo", async (_e, dirPath) => {
    if (!dirPath?.trim()) return false;
    return isGitRepo(dirPath);
  });
  ipcMain.handle("repos:getCreateDefaults", async () => {
    const { gitignores, licenses } = listTemplates();
    const defaultPath = path.join(app.getPath("documents"), "GitHub");
    return { defaultPath, gitignores, licenses };
  });
  ipcMain.handle(
    "repos:checkRemoteRepo",
    async (_e, name, accountId, owner) => {
      try {
        return await findRemoteRepo(name, accountId, owner);
      } catch {
        return null;
      }
    }
  );
  ipcMain.handle(
    "repos:createRepo",
    async (e, options) => {
      const existing = await findRemoteRepo(options.name, options.accountId, options.owner).catch(() => null);
      if (existing) {
        throw new Error(
          `A repository named "${existing.name}" already exists on ${existing.owner}. Pick a different name, account, or organization.`
        );
      }
      const result = await createRepo(options);
      if (!result.ok || !result.path) {
        throw new Error(result.error ?? "Failed to create repository.");
      }
      let info = preservePinnedAccount(await buildRepoInfo(result.path));
      if (options.accountId) info = { ...info, githubAccountId: options.accountId };
      upsertRepo(info);
      setPrefs({ activeRepoId: info.id });
      broadcastToOthers(e.sender.id, "repos:active-changed", info);
      return info;
    }
  );
  ipcMain.handle(
    "github:listAccountOrganizations",
    async (_e, accountId) => {
      return listOrganizations(accountId).catch(() => []);
    }
  );
  ipcMain.handle("github:listOrganizations", async (_e, repoId) => {
    const accountId = repoId ? getRepo(repoId)?.githubAccountId : null;
    return listOrganizations(accountId).catch(() => []);
  });
  ipcMain.handle(
    "github:resolveCommitAuthors",
    async (_e, repoId, candidates) => {
      const repo = getRepo(repoId);
      if (!repo?.githubOwner || !repo?.githubRepo) return {};
      return resolveCommitAuthors(repo.githubOwner, repo.githubRepo, candidates, repo.githubAccountId).catch(() => ({}));
    }
  );
  ipcMain.handle(
    "repos:publish",
    async (e, repoId, options) => {
      const repo = repoOrThrow(repoId);
      const accountId = repo.githubAccountId ?? null;
      await ensureInitialCommit(
        repo.path,
        "Initial commit",
        resolveCommitIdentity(accountId),
        await resolveCommitSigning(accountId)
      );
      const remote = await createRemoteRepo({
        name: options.name,
        description: options.description,
        private: options.private,
        org: options.org,
        accountId
      });
      const result = await setOriginAndPush(repo.path, remote.cloneUrl);
      if (!result.ok) {
        throw new Error(
          result.error ? `Repository created at ${remote.htmlUrl}, but the push failed: ${result.error}` : "Failed to push to the new remote."
        );
      }
      const info = preservePinnedAccount(await buildRepoInfo(repo.path));
      upsertRepo(info);
      broadcastToOthers(e.sender.id, "repos:active-changed", info);
      return info;
    }
  );
  ipcMain.handle("repos:remove", async (e, id, moveToTrash) => {
    const repo = getRepo(id);
    removeRepo(id);
    if (moveToTrash && repo) {
      void shell.trashItem(repo.path).catch(() => {
        e.sender.send("repos:trash-failed", repo.name);
      });
    }
  });
  ipcMain.handle("repos:setActive", async (_e, id) => {
    const repo = getRepo(id);
    if (!repo) return null;
    const updated = { ...repo, lastOpenedAt: Date.now() };
    upsertRepo(updated);
    setPrefs({ activeRepoId: id });
    broadcast("repos:active-changed", updated);
    void refreshRepoInfoInBackground(repo.path, updated);
    return updated;
  });
  ipcMain.handle("repos:getActive", async () => {
    const prefs = getPrefs();
    if (!prefs.activeRepoId) return null;
    const repo = getRepo(prefs.activeRepoId);
    if (repo) void refreshRepoInfoInBackground(repo.path, repo);
    return repo;
  });
  ipcMain.handle("git:listBranches", async (_e, repoId) => {
    return listBranches(repoOrThrow(repoId).path);
  });
  ipcMain.handle(
    "git:listLocalOnlyBranches",
    async (_e, repoId) => {
      return listLocalOnlyBranches(repoOrThrow(repoId).path);
    }
  );
  ipcMain.handle("git:getCurrentBranch", async (_e, repoId) => {
    return getCurrentBranch(repoOrThrow(repoId).path);
  });
  ipcMain.handle("git:checkout", async (_e, repoId, branch) => {
    await checkout(repoOrThrow(repoId).path, branch);
  });
  ipcMain.handle(
    "git:checkoutPR",
    async (_e, repoId, pr, source = "fork") => {
      const repo = repoOrThrow(repoId);
      const fallbackRemote = source === "upstream" && repo.upstreamOwner && repo.upstreamRepo ? upstreamFetchUrl(repo) : "origin";
      await checkoutPR(repo.path, {
        prNumber: pr.number,
        headRef: pr.headRef,
        headRepoUrl: pr.headRepoCloneUrl,
        headRepoOwner: pr.headRepoOwner,
        originUrl: repo.remoteUrl,
        fallbackRemote
      });
      setPRBranch(repoId, pr.headRef, { number: pr.number, source });
    }
  );
  ipcMain.handle("git:isDirty", async (_e, repoId) => {
    return isWorkingTreeDirty(repoOrThrow(repoId).path);
  });
  ipcMain.handle(
    "git:createBranch",
    async (_e, repoId, name, opts) => {
      const result = await createBranch(repoOrThrow(repoId).path, name, opts);
      if (result.ok) bumpStat(repoId, "branchesCreated");
      return result;
    }
  );
  ipcMain.handle(
    "git:deleteBranch",
    async (_e, repoId, name, opts) => deleteBranch(repoOrThrow(repoId).path, name, opts)
  );
  ipcMain.handle(
    "git:listChangedFiles",
    async (_e, repoId, ctx) => {
      if (ctx.kind === "session") {
        const repoPath = repoOrThrow(repoId).path;
        const session2 = ctx.ref ? await getSessionAtRef(repoPath, ctx.ref, ctx.sessionId) : await getSession(repoPath, ctx.sessionId);
        return (session2?.files ?? []).map((f) => ({
          path: f.path,
          oldPath: f.oldPath,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          isBinary: f.isBinary
        }));
      }
      return listChangedFiles(repoOrThrow(repoId).path, ctx);
    }
  );
  ipcMain.handle("git:refExists", async (_e, repoId, ref) => {
    return refExists(repoOrThrow(repoId).path, ref);
  });
  ipcMain.handle(
    "git:getDiff",
    async (_e, repoId, filePath, ctx) => {
      if (ctx.kind === "session") {
        const repoPath = repoOrThrow(repoId).path;
        const session2 = ctx.ref ? await getSessionAtRef(repoPath, ctx.ref, ctx.sessionId) : await getSession(repoPath, ctx.sessionId);
        const f = session2?.files.find((x) => x.path === filePath);
        if (!f) {
          throw new Error(`File not in session ${ctx.sessionId}: ${filePath}`);
        }
        return {
          file: {
            path: f.path,
            oldPath: f.oldPath,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            isBinary: f.isBinary
          },
          patch: f.patch,
          oldContents: f.oldContents,
          newContents: f.newContents,
          truncated: f.truncated,
          oldImage: f.oldImage,
          newImage: f.newImage
        };
      }
      return getDiff(repoOrThrow(repoId).path, filePath, ctx);
    }
  );
  ipcMain.handle("git:fetchOrigin", async (_e, repoId) => {
    return fetchOrigin(repoOrThrow(repoId).path);
  });
  ipcMain.handle("git:getPushStatus", async (_e, repoId) => {
    const repo = repoOrThrow(repoId);
    let defaultBranch = repo.defaultBranch;
    if (!defaultBranch) {
      const detected = await getDefaultBranch(repo.path);
      if (detected) {
        defaultBranch = detected;
        const merged = { ...repo, defaultBranch: detected };
        upsertRepo(merged);
        broadcast("repos:active-changed", merged);
      }
    }
    return getPushStatus(repo.path, defaultBranch);
  });
  ipcMain.handle(
    "git:pull",
    async (_e, repoId) => pull(repoOrThrow(repoId).path)
  );
  ipcMain.handle(
    "git:push",
    async (_e, repoId) => push(repoOrThrow(repoId).path)
  );
  ipcMain.handle(
    "git:mergeIntoCurrent",
    async (_e, repoId, ref) => mergeIntoCurrent(repoOrThrow(repoId).path, ref)
  );
  ipcMain.handle(
    "git:updateFromUpstream",
    async (_e, repoId, branch) => {
      const repo = repoOrThrow(repoId);
      if (!repo.upstreamOwner || !repo.upstreamRepo) {
        return {
          ok: false,
          conflicts: [],
          error: "This repository does not have an upstream."
        };
      }
      return updateFromUpstream(repo.path, upstreamFetchUrl(repo), branch);
    }
  );
  ipcMain.handle(
    "git:getConflicts",
    async (_e, repoId) => getConflicts(repoOrThrow(repoId).path)
  );
  ipcMain.handle(
    "git:recheckConflicts",
    async (_e, repoId, files) => recheckConflicts(repoOrThrow(repoId).path, files)
  );
  ipcMain.handle(
    "git:stageFile",
    async (_e, repoId, filePath) => stageFile(repoOrThrow(repoId).path, filePath)
  );
  ipcMain.handle(
    "git:discardChanges",
    async (_e, repoId, filePath, oldPath) => (
      // Inject the OS-trash implementation: core stays Electron-free, so the
      // app supplies `shell.trashItem` to keep discards of new/untracked files
      // recoverable (move to trash) rather than hard-deleting them.
      discardChanges(
        repoOrThrow(repoId).path,
        filePath,
        oldPath,
        (p) => import("electron").then(({ shell: shell2 }) => shell2.trashItem(p))
      )
    )
  );
  ipcMain.handle(
    "git:discardFiles",
    async (_e, repoId, files) => (
      // Same OS-trash injection as git:discardChanges, applied across the batch.
      discardFiles(
        repoOrThrow(repoId).path,
        files,
        (p) => import("electron").then(({ shell: shell2 }) => shell2.trashItem(p))
      )
    )
  );
  ipcMain.handle(
    "git:discardLines",
    async (_e, repoId, _filePath, patch) => discardLines(repoOrThrow(repoId).path, patch)
  );
  ipcMain.handle(
    "git:addToGitignore",
    async (_e, repoId, patterns) => addToGitignore(repoOrThrow(repoId).path, patterns)
  );
  ipcMain.handle(
    "git:continueMerge",
    async (_e, repoId) => continueMerge(repoOrThrow(repoId).path)
  );
  ipcMain.handle("git:abortMerge", async (_e, repoId) => {
    await abortMerge(repoOrThrow(repoId).path);
  });
  ipcMain.handle(
    "git:createManagedStash",
    async (_e, repoId) => {
      const repo = repoOrThrow(repoId);
      const branch = await getCurrentBranch(repo.path);
      if (!branch) return { ok: false, error: "Not on a branch (detached HEAD)." };
      return createManagedStash(repo.path, branch);
    }
  );
  ipcMain.handle(
    "git:findManagedStash",
    async (_e, repoId) => {
      const repo = repoOrThrow(repoId);
      const branch = await getCurrentBranch(repo.path);
      if (!branch) return null;
      return findManagedStash(repo.path, branch);
    }
  );
  ipcMain.handle(
    "git:restoreManagedStash",
    async (_e, repoId, ref) => restoreManagedStash(repoOrThrow(repoId).path, ref)
  );
  ipcMain.handle(
    "git:restoreManagedStashKeepingLocal",
    async (_e, repoId, ref) => restoreManagedStashKeepingLocal(repoOrThrow(repoId).path, ref)
  );
  ipcMain.handle(
    "git:discardManagedStash",
    async (_e, repoId, ref) => {
      await discardManagedStash(repoOrThrow(repoId).path, ref);
    }
  );
  ipcMain.handle(
    "git:finishStashPop",
    async (_e, repoId, ref) => finishStashPop(repoOrThrow(repoId).path, ref)
  );
  ipcMain.handle("git:abortStashPop", async (_e, repoId) => {
    await abortStashPop(repoOrThrow(repoId).path);
  });
  ipcMain.handle(
    "git:commit",
    async (_e, repoId, message, files) => {
      const repo = repoOrThrow(repoId);
      const identity = resolveCommitIdentity(repo.githubAccountId);
      const signing = await resolveCommitSigning(repo.githubAccountId);
      const result = await commit(repo.path, message, files, identity, signing);
      if (result.ok) {
        bumpStat(repoId, "commitsAuthored");
        addStat(repoId, "filesCommitted", result.filesCommitted ?? 0);
        addStat(repoId, "linesCommitted", result.linesCommitted ?? 0);
      }
      return result;
    }
  );
  ipcMain.handle(
    "git:getLastCommit",
    async (_e, repoId) => getLastCommit(repoOrThrow(repoId).path)
  );
  ipcMain.handle(
    "git:listCommits",
    async (_e, repoId, head, limit) => listCommits(repoOrThrow(repoId).path, head, limit)
  );
  ipcMain.handle(
    "git:listLocalCommits",
    async (_e, repoId, limit) => listLocalCommits(repoOrThrow(repoId).path, limit)
  );
  ipcMain.handle(
    "git:mergeBase",
    async (_e, repoId, a, b) => mergeBase(repoOrThrow(repoId).path, a, b)
  );
  ipcMain.handle(
    "git:undoLastCommit",
    async (_e, repoId) => undoLastCommit(repoOrThrow(repoId).path)
  );
  ipcMain.handle(
    "git:convertToFork",
    async (_e, repoId, forkOwner, forkRepo, contributeToParent) => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error("This repository does not have a GitHub remote to fork.");
      }
      const parent = { owner: repo.githubOwner, repo: repo.githubRepo };
      const forkUrl = repoFetchUrl(repo, forkOwner, forkRepo);
      const upstreamUrl = contributeToParent ? repo.remoteUrl ?? `https://github.com/${parent.owner}/${parent.repo}.git` : null;
      await convertToForkRemotes(repo.path, forkUrl, upstreamUrl);
      const updated = setRepoFork(
        repoId,
        { owner: forkOwner, repo: forkRepo, url: forkUrl },
        contributeToParent ? parent : null
      );
      if (!updated) throw new Error("Failed to update repository after forking.");
      broadcast("repos:active-changed", updated);
      return updated;
    }
  );
  ipcMain.handle(
    "git:setForkContribution",
    async (_e, repoId, contributeToParent) => {
      const repo = repoOrThrow(repoId);
      if (contributeToParent) {
        if (!repo.githubOwner || !repo.githubRepo) {
          throw new Error("This repository does not have a GitHub remote.");
        }
        const parent = await getUpstream(
          repo.githubOwner,
          repo.githubRepo,
          repo.githubAccountId
        );
        if (!parent) throw new Error("This repository is not a fork, so it has no parent.");
        await addUpstreamRemote(repo.path, repoFetchUrl(repo, parent.owner, parent.repo));
        const updated2 = setRepoUpstream(repoId, parent);
        if (!updated2) throw new Error("Failed to update repository.");
        broadcast("repos:active-changed", updated2);
        return updated2;
      }
      await removeUpstreamRemote(repo.path);
      const updated = setRepoUpstream(repoId, null);
      if (!updated) throw new Error("Failed to update repository.");
      broadcast("repos:active-changed", updated);
      return updated;
    }
  );
  ipcMain.handle("changesets:getStatus", async (_e, repoId) => {
    return getChangesetStatus(repoOrThrow(repoId).path);
  });
  ipcMain.handle(
    "changesets:create",
    async (_e, repoId, input) => {
      return createChangeset(repoOrThrow(repoId).path, input);
    }
  );
  ipcMain.handle(
    "changesets:remove",
    async (_e, repoId, filePath) => {
      await removeChangeset(repoOrThrow(repoId).path, filePath);
    }
  );
  ipcMain.handle(
    "changesets:generate",
    async (e, repoId, request) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      return generateChangeset(repoOrThrow(repoId).path, request, {
        onActivity: (status) => {
          if (win) sendToWindow(win, "changesets:progress", { status });
        }
      });
    }
  );
  ipcMain.handle(
    "changesets:cancelGenerate",
    async () => cancelChangesetGeneration()
  );
  ipcMain.handle("git:cloneRepo", async (_e, url) => {
    const dir = await dialog.showOpenDialog({
      title: "Clone destination",
      properties: ["openDirectory", "createDirectory"]
    });
    if (dir.canceled || dir.filePaths.length === 0) {
      return { ok: false, error: "Clone cancelled." };
    }
    const result = await cloneRepo(url, dir.filePaths[0]);
    if (result.ok && result.path) {
      const info = preservePinnedAccount(await buildRepoInfo(result.path));
      upsertRepo(info);
      setPrefs({ activeRepoId: info.id });
      broadcast("repos:active-changed", info);
    }
    return result;
  });
  ipcMain.handle("editor:detect", async () => detectEditors());
  ipcMain.handle(
    "editor:open",
    async (_e, editor, target, line) => openInEditor(editor, target, line)
  );
  ipcMain.handle("terminal:detect", async () => detectTerminals());
  ipcMain.handle(
    "terminal:open",
    async (_e, terminal, target) => openInTerminal(terminal, target)
  );
  onAuthErrorsChanged((errors) => broadcast("github:auth-changed", errors));
  ipcMain.handle(
    "github:getAuthErrors",
    async () => getAuthErrors()
  );
  ipcMain.handle(
    "github:validateAccounts",
    async () => validateAccounts()
  );
  ipcMain.handle("github:listAccounts", async () => listAccounts());
  ipcMain.handle(
    "github:getActiveAccount",
    async () => getActiveAccount()
  );
  ipcMain.handle(
    "github:setActiveAccount",
    async (_e, id) => setActiveAccount(id)
  );
  ipcMain.handle("github:removeAccount", async (_e, id) => removeAccount(id));
  ipcMain.handle(
    "github:setRepoAccount",
    async (_e, repoId, accountId) => {
      const updated = setRepoGithubAccountId(repoId, accountId);
      if (updated) broadcast("repos:active-changed", updated);
      return updated;
    }
  );
  ipcMain.handle(
    "github:startDeviceFlow",
    async () => startDeviceFlow()
  );
  ipcMain.handle(
    "github:pollDeviceFlow",
    async () => pollDeviceFlow()
  );
  ipcMain.handle("github:cancelDeviceFlow", async () => cancelDeviceFlow());
  ipcMain.handle(
    "github:listPRs",
    async (_e, repoId, page = 1, source = "fork") => {
      const repo = repoOrThrow(repoId);
      const owner = source === "upstream" ? repo.upstreamOwner : repo.githubOwner;
      const name = source === "upstream" ? repo.upstreamRepo : repo.githubRepo;
      if (!owner || !name) {
        throw new Error(
          source === "upstream" ? "This repository does not have an upstream." : "This repository does not have a GitHub remote."
        );
      }
      return listPullRequests(owner, name, repo.githubAccountId, page);
    }
  );
  const hostRepoOrThrow = (repoId) => {
    const repo = repoOrThrow(repoId);
    const owner = repo.upstreamOwner ?? repo.githubOwner;
    const name = repo.upstreamRepo ?? repo.githubRepo;
    if (!owner || !name) throw new Error("This repository does not have a GitHub remote.");
    return { owner, name, account: repo.githubAccountId };
  };
  ipcMain.handle(
    "github:listMentionableUsers",
    async (_e, repoId) => {
      const { owner, name, account } = hostRepoOrThrow(repoId);
      return listMentionableUsers(owner, name, account);
    }
  );
  ipcMain.handle(
    "github:listIssueReferences",
    async (_e, repoId, query) => {
      const { owner, name, account } = hostRepoOrThrow(repoId);
      return listIssueReferences(owner, name, account, query);
    }
  );
  ipcMain.handle(
    "github:getRepoPushAccess",
    async (_e, repoId) => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) return false;
      return canPushToRepo(repo.githubOwner, repo.githubRepo, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:createFork",
    async (_e, repoId) => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error("This repository does not have a GitHub remote to fork.");
      }
      return createFork(repo.githubOwner, repo.githubRepo, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:getRepoParent",
    async (_e, repoId) => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) return null;
      return getUpstream(repo.githubOwner, repo.githubRepo, repo.githubAccountId);
    }
  );
  ipcMain.handle("github:detectUpstream", async (_e, repoId) => {
    const repo = repoOrThrow(repoId);
    if (!repo.githubOwner || !repo.githubRepo) return repo;
    let upstream;
    try {
      upstream = await getUpstream(repo.githubOwner, repo.githubRepo, repo.githubAccountId);
    } catch {
      upstream = null;
    }
    return setRepoUpstream(repoId, upstream) ?? repo;
  });
  ipcMain.handle(
    "github:fetchPR",
    async (_e, repoId, prNumber, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      const { baseRef } = await getPRBase(owner, name, prNumber, repo.githubAccountId);
      const isOrigin = owner.toLowerCase() === (repo.githubOwner ?? "").toLowerCase() && name.toLowerCase() === (repo.githubRepo ?? "").toLowerCase();
      const remote = isOrigin ? "origin" : repoFetchUrl(repo, owner, name);
      const refs = await fetchPRRef(repo.path, prNumber, remote);
      await pinPRBaseRef(repo.path, prNumber, baseRef, remote);
      return refs;
    }
  );
  ipcMain.handle(
    "github:findPRForBranch",
    async (_e, repoId, branch) => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        console.log(
          `[github] findPRForBranch skipped: repo "${repo.name}" has no GitHub remote (owner=${repo.githubOwner ?? "∅"} repo=${repo.githubRepo ?? "∅"})`
        );
        return null;
      }
      const headOwner = repo.githubOwner;
      const bases = [];
      if (repo.upstreamOwner && repo.upstreamRepo) {
        bases.push({ owner: repo.upstreamOwner, repo: repo.upstreamRepo });
      }
      bases.push({ owner: repo.githubOwner, repo: repo.githubRepo });
      for (const base of bases) {
        try {
          const pr = await findPRForBranch(
            base.owner,
            base.repo,
            headOwner,
            branch,
            repo.githubAccountId
          );
          if (pr) return pr;
        } catch (err) {
          console.error(
            `[github] findPRForBranch failed for base=${base.owner}/${base.repo} head=${headOwner}:${branch} pinnedAccountId=${repo.githubAccountId ?? "(none)"}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      const link = getPRBranch(repoId, branch);
      if (link) {
        const owner = link.source === "upstream" ? repo.upstreamOwner : repo.githubOwner;
        const name = link.source === "upstream" ? repo.upstreamRepo : repo.githubRepo;
        if (owner && name) {
          try {
            return await getPRSummary(owner, name, link.number, repo.githubAccountId);
          } catch {
            return null;
          }
        }
      }
      return null;
    }
  );
  ipcMain.handle(
    "github:canPushToPR",
    async (_e, repoId, pr) => {
      const repo = repoOrThrow(repoId);
      const baseOwner = pr.repoOwner ?? repo.githubOwner;
      const baseRepo = pr.repoName ?? repo.githubRepo;
      if (!baseOwner || !baseRepo) return false;
      try {
        return await canPushToPR(
          {
            headOwner: pr.headRepoOwner,
            headRepo: pr.headRepoName,
            baseOwner,
            baseRepo,
            prNumber: pr.number,
            maintainerCanModify: pr.maintainerCanModify
          },
          repo.githubAccountId
        );
      } catch {
        return null;
      }
    }
  );
  ipcMain.handle(
    "github:getChecks",
    async (_e, repoId, ref, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const empty = { state: "none", checks: [], deployments: [] };
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) return empty;
      try {
        return await getChecks(owner, name, ref, repo.githubAccountId);
      } catch (err) {
        console.error(
          `[github] getChecks failed for ${owner}/${name} ref=${ref}:`,
          err instanceof Error ? err.message : err
        );
        return empty;
      }
    }
  );
  ipcMain.handle(
    "github:getPR",
    async (_e, repoId, prNumber, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) return null;
      return getPRSummary(owner, name, prNumber, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:listReviewComments",
    async (_e, repoId, prNumber, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return listReviewComments(owner, name, prNumber, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:createReviewComment",
    async (_e, repoId, input, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      const anchorRef = input.headRef ?? `pr/${input.prNumber}/head`;
      const snapshotSha = await resolveRef(repo.path, anchorRef);
      return createReviewComment(owner, name, input, repo.githubAccountId, snapshotSha);
    }
  );
  ipcMain.handle(
    "github:replyReviewComment",
    async (_e, repoId, prNumber, commentId, body, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return replyReviewComment(owner, name, prNumber, commentId, body, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:deleteReviewComment",
    async (_e, repoId, commentId, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      await deleteReviewComment(owner, name, commentId, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:updateReviewComment",
    async (_e, repoId, commentId, body, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return updateReviewComment(owner, name, commentId, body, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:setReviewThreadResolved",
    async (_e, repoId, threadId, resolved) => {
      const repo = repoOrThrow(repoId);
      return setReviewThreadResolved(threadId, resolved, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:listConversation",
    async (_e, repoId, prNumber, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return listConversation(owner, name, prNumber, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:createIssueComment",
    async (_e, repoId, prNumber, body, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return createIssueComment(owner, name, prNumber, body, repo.githubAccountId);
    }
  );
  ipcMain.handle("feedback:submit", async (_e, input) => {
    return submitFeedback(input);
  });
  ipcMain.handle(
    "github:deleteIssueComment",
    async (_e, repoId, commentId, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      await deleteIssueComment(owner, name, commentId, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:updateIssueComment",
    async (_e, repoId, commentId, body, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return updateIssueComment(owner, name, commentId, body, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:updatePullRequestBody",
    async (_e, repoId, prNumber, body, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return updatePullRequestBody(owner, name, prNumber, body, repo.githubAccountId);
    }
  );
  ipcMain.handle(
    "github:mergePullRequest",
    async (_e, repoId, prNumber, method, prOwner, prRepo, commitTitle, commitMessage) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      const result = await mergePullRequest(
        owner,
        name,
        prNumber,
        method,
        repo.githubAccountId,
        commitTitle,
        commitMessage
      );
      if (result.merged) bumpStat(repoId, "prsMerged");
      return result;
    }
  );
  ipcMain.handle(
    "github:markPullRequestReady",
    async (_e, repoId, prNumber, prOwner, prRepo) => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      await markPullRequestReady(owner, name, prNumber, repo.githubAccountId);
    }
  );
  ipcMain.handle("npm:getPackageInfo", async (_e, name) => {
    return getNpmPackageInfo(name);
  });
  ipcMain.handle(
    "npm:getReleaseNotes",
    async (_e, repositoryUrl, packageName, version) => {
      return getReleaseNotes(repositoryUrl, packageName, version);
    }
  );
  ipcMain.handle(
    "npm:getReleaseNotesRange",
    async (_e, repositoryUrl, packageName, fromVersion, toVersion) => {
      return getReleaseNotesRange(repositoryUrl, packageName, fromVersion, toVersion);
    }
  );
  ipcMain.handle("shell:openExternal", async (_e, url) => {
    await shell.openExternal(url);
  });
  ipcMain.handle("shell:showItemInFolder", async (_e, fullPath) => {
    shell.showItemInFolder(fullPath);
  });
  ipcMain.handle(
    "shell:openPath",
    async (_e, fullPath) => {
      const error = await shell.openPath(fullPath);
      return error ? { ok: false, error } : { ok: true };
    }
  );
  ipcMain.handle(
    "menu:showFileContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const item = (label, action) => ({
        label,
        click: () => {
          chosen = { action };
        }
      });
      const ignoreItem = (label, patterns) => ({
        label,
        click: () => {
          chosen = { action: "ignore", patterns };
        }
      });
      const extensionItems = () => params.ignoreExtensions.map(
        (ext) => ignoreItem(`Ignore All ${ext} Files (Add to .gitignore)`, [`*${ext}`])
      );
      const template = [];
      if (params.selectedCount > 1) {
        const n = params.selectedCount;
        const groups = [];
        if (params.canDiscard) {
          groups.push([item(`Discard ${n} Selected Files`, "discardSelected")]);
        }
        groups.push([
          item(`Mark ${n} Selected Files as Seen`, "markSeen"),
          item(`Mark ${n} Selected Files as Unseen`, "markUnseen")
        ]);
        if (params.canInclude) {
          groups.push([
            item(`Include ${n} Selected Files`, "includeSelected"),
            item(`Exclude ${n} Selected Files`, "excludeSelected")
          ]);
        }
        const ignoreGroup = [];
        if (params.ignoreSelected.length > 0) {
          const m = params.ignoreSelected.length;
          ignoreGroup.push(
            ignoreItem(
              `Ignore ${m} Selected ${m === 1 ? "File" : "Files"} (Add to .gitignore)`,
              params.ignoreSelected
            )
          );
        }
        ignoreGroup.push(...extensionItems());
        if (ignoreGroup.length > 0) groups.push(ignoreGroup);
        groups.forEach((group, i) => {
          if (i > 0) template.push({ type: "separator" });
          template.push(...group);
        });
      } else {
        if (params.canDiscard) {
          template.push(item("Discard Changes", "discard"));
          template.push({ type: "separator" });
        }
        template.push(
          params.isSeen ? item("Mark as Unseen", "markUnseen") : item("Mark as Seen", "markSeen")
        );
        template.push({ type: "separator" });
        const ignoreGroup = [];
        if (params.ignoreFile) {
          ignoreGroup.push(ignoreItem("Ignore File (Add to .gitignore)", [params.ignoreFile]));
        }
        if (params.ignoreFolders.length > 0) {
          ignoreGroup.push({
            label: "Ignore Folder (Add to .gitignore)",
            submenu: params.ignoreFolders.map((folder) => ignoreItem(folder, [folder]))
          });
        }
        ignoreGroup.push(...extensionItems());
        if (ignoreGroup.length > 0) {
          template.push(...ignoreGroup, { type: "separator" });
        }
        template.push(item("Copy File Path", "copyPath"));
        template.push(item("Copy Relative File Path", "copyRelativePath"));
        template.push({ type: "separator" });
        template.push(item(params.revealLabel, "reveal"));
        if (params.editorLabel) {
          template.push(item(`Open in ${params.editorLabel}`, "openInEditor"));
        }
        template.push(item("Open with Default Program", "openDefault"));
      }
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showDiffLineContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const label = params.scope === "lines" ? "Discard modified lines" : "Discard modified line";
      const template = [
        {
          label,
          click: () => {
            chosen = "discard";
          }
        }
      ];
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showBranchContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const item = (label, action) => ({
        label,
        click: () => {
          chosen = action;
        }
      });
      const template = [];
      if (params.canView) {
        template.push(item("View Read-Only", "view"));
        template.push({ type: "separator" });
      }
      template.push(item("Copy Branch Name", "copy"));
      if (params.canDelete) {
        template.push({ type: "separator" });
        template.push(item("Delete Branch…", "delete"));
      }
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showTaskContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const item = (label, action) => ({
        label,
        click: () => {
          chosen = action;
        }
      });
      const template = [
        item(params.done ? "Mark as Not Done" : "Mark as Done", "toggle"),
        item(params.onHold ? "Remove Hold" : "Put on Hold", "hold")
      ];
      if (params.canAddSubtask) template.push(item("Add Subtask…", "addSubtask"));
      template.push(item("Edit…", "edit"), { type: "separator" }, item("Delete", "delete"));
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showPRContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const item = (label, action) => ({
        label,
        click: () => {
          chosen = action;
        }
      });
      const template = [];
      if (params.canView) {
        template.push(item("View Read-Only", "view"));
        template.push({ type: "separator" });
      }
      template.push(item("Copy Link", "copyUrl"));
      template.push(item("Open on GitHub", "openOnGitHub"));
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showRepoContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const item = (label, action) => ({
        label,
        click: () => {
          chosen = action;
        }
      });
      const template = [
        item("Copy Path", "copyPath"),
        item(params.revealLabel, "reveal"),
        { type: "separator" },
        item("Repository Settings…", "settings"),
        item("Remove…", "remove")
      ];
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showCommitContextMenu",
    async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const item = (label, action) => ({
        label,
        click: () => {
          chosen = action;
        }
      });
      const menu = Menu.buildFromTemplate([
        item("Copy Short Hash", "copyShortHash"),
        item("Copy Full Hash", "copyFullHash")
      ]);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showHeaderContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const template = params.items.map(
        (it) => ({
          label: it.label,
          type: "checkbox",
          checked: it.checked,
          click: (menuItem) => {
            chosen = { key: it.key, checked: menuItem.checked };
          }
        })
      );
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showEmptyViewContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const template = params.items.map(
        (it) => ({
          label: it.label,
          type: "checkbox",
          checked: it.checked,
          click: (menuItem) => {
            chosen = { key: it.key, checked: menuItem.checked };
          }
        })
      );
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showFileHeaderContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const template = params.items.map(
        (it) => ({
          label: it.label,
          type: "checkbox",
          checked: it.checked,
          click: (menuItem) => {
            chosen = { key: it.key, checked: menuItem.checked };
          }
        })
      );
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showTabsContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const template = params.items.map(
        (it) => ({
          label: it.label,
          type: "checkbox",
          checked: it.checked,
          click: (menuItem) => {
            chosen = { key: it.key, checked: menuItem.checked };
          }
        })
      );
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle(
    "menu:showSidebarControlsContextMenu",
    async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen = null;
      const template = params.items.map(
        (it) => ({
          label: it.label,
          type: "checkbox",
          checked: it.checked,
          click: (menuItem) => {
            chosen = { key: it.key, checked: menuItem.checked };
          }
        })
      );
      const menu = Menu.buildFromTemplate(template);
      return await new Promise((resolve) => {
        menu.popup({
          window: win ?? void 0,
          callback: () => resolve(chosen)
        });
      });
    }
  );
  ipcMain.handle("state:getPrefs", async () => getPrefs());
  ipcMain.handle(
    "state:setPrefs",
    async (_e, patch) => setPrefs(patch)
  );
  ipcMain.handle("settings:getPath", async () => settingsFilePath());
  ipcMain.handle("settings:reveal", async () => {
    shell.showItemInFolder(settingsFilePath());
  });
  ipcMain.handle(
    "settings:getStartupIssues",
    async () => {
      const issues = getSettingsStartupIssues();
      clearSettingsStartupIssues();
      return issues;
    }
  );
  ipcMain.handle("settings:openInEditor", async () => {
    const target = settingsFilePath();
    const editor = getPrefs().externalEditor;
    if (editor) return openInEditor(editor, target);
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle(
    "settings:export",
    async () => {
      const result = await dialog.showSaveDialog({
        title: "Export settings",
        defaultPath: "settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      try {
        await writeFile(result.filePath, currentSettingsText(), "utf8");
        return { ok: true, canceled: false, path: result.filePath };
      } catch (err) {
        return {
          ok: false,
          canceled: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }
  );
  ipcMain.handle(
    "settings:import",
    async () => {
      const result = await dialog.showOpenDialog({
        title: "Import settings",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
      try {
        const text2 = await readFile(result.filePaths[0], "utf8");
        const raw = JSON.parse(text2);
        const { prefs, reset } = replacePrefsSettings(raw);
        broadcast("state:prefsChanged", { prefs, reset: [], malformed: false });
        return { ok: true, canceled: false, reset, prefs };
      } catch (err) {
        return {
          ok: false,
          canceled: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }
  );
  ipcMain.handle("settings:reset", async () => {
    const prefs = resetPrefsSettings();
    broadcast("state:prefsChanged", { prefs, reset: [], malformed: false });
    return prefs;
  });
  watchSettingsFile((parsed) => {
    const prefs = getPrefs();
    syncTitleBarOverlay(prefs.theme);
    broadcast("state:prefsChanged", {
      prefs,
      reset: parsed.reset,
      malformed: parsed.malformed
    });
  });
  ipcMain.handle(
    "stats:get",
    async (_e, repoId) => getStats(repoId)
  );
  ipcMain.handle(
    "stats:getAll",
    async () => getAllStats()
  );
  ipcMain.handle(
    "stats:recordFileReviewed",
    async (_e, repoId, sig, loc) => recordFileReviewed(repoId, sig, loc)
  );
  ipcMain.handle(
    "stats:recordSessionReviewed",
    async (_e, repoId, sessionId) => recordSessionReviewed(repoId, sessionId)
  );
  ipcMain.handle(
    "icons:resolveCustomIcon",
    async (_e, source) => resolveCustomIcon(source)
  );
  ipcMain.handle("icons:pickIconFile", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: "Choose an icon image",
      properties: ["openFile"],
      // Same image types resolveCustomIcon will accept (extensions without the dot).
      filters: [
        { name: "Images", extensions: Object.keys(ICON_MIME_BY_EXT).map((ext) => ext.slice(1)) }
      ]
    };
    const result = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle(
    "state:getSeenFiles",
    async (_e, repoId, contextKey) => {
      return getSeen(repoId, contextKey);
    }
  );
  ipcMain.handle(
    "state:getSeenSignatures",
    async (_e, repoId, contextKey) => {
      return getSeenSignatures(repoId, contextKey);
    }
  );
  ipcMain.handle(
    "state:getInheritedSeen",
    async (_e, repoId, contextKey, fileDiffSigs) => {
      return getInheritedSeen(repoId, contextKey, fileDiffSigs);
    }
  );
  ipcMain.handle(
    "state:getRetainedSeen",
    async (_e, repoId, contextKey, fileDiffSigs) => {
      return getRetainedSeen(repoId, contextKey, fileDiffSigs);
    }
  );
  ipcMain.handle(
    "state:setFileSeen",
    async (_e, repoId, contextKey, filePath, seen, sig) => {
      setSeen(repoId, contextKey, filePath, seen, sig);
    }
  );
  ipcMain.handle(
    "state:clearSeen",
    async (_e, repoId, contextKey) => clearSeen(repoId, contextKey)
  );
  ipcMain.handle(
    "state:getCollapsedFiles",
    async (_e, repoId, contextKey) => {
      return getCollapsedFiles(repoId, contextKey);
    }
  );
  ipcMain.handle(
    "state:setFileCollapsed",
    async (_e, repoId, contextKey, filePath, collapsed) => {
      setFileCollapsed(repoId, contextKey, filePath, collapsed);
    }
  );
  ipcMain.handle(
    "state:setFilesCollapsed",
    async (_e, repoId, contextKey, filePaths, collapsed) => {
      setFilesCollapsed(repoId, contextKey, filePaths, collapsed);
    }
  );
  ipcMain.handle(
    "state:clearCollapsedFiles",
    async (_e, repoId, contextKey) => clearCollapsedFiles(repoId, contextKey)
  );
  ipcMain.handle(
    "state:getCachedFileList",
    async (_e, repoId, contextKey) => {
      return getCachedFileList(repoId, contextKey);
    }
  );
  ipcMain.handle(
    "state:setCachedFileList",
    async (_e, repoId, contextKey, files) => {
      setCachedFileList(repoId, contextKey, files);
    }
  );
  ipcMain.handle(
    "state:getBranchBase",
    async (_e, repoId, branch) => {
      return getBranchBase(repoId, branch);
    }
  );
  ipcMain.handle(
    "state:setBranchBase",
    async (_e, repoId, branch, base) => {
      setBranchBase(repoId, branch, base);
    }
  );
  ipcMain.handle(
    "state:getCommitDraft",
    async (_e, repoId) => getCommitDraft(repoId)
  );
  ipcMain.handle(
    "state:setCommitDraft",
    async (_e, repoId, draft) => {
      setCommitDraft(repoId, draft);
    }
  );
  ipcMain.handle(
    "sessions:list",
    async (_e, repoId, ref) => {
      const repoPath = repoOrThrow(repoId).path;
      return ref ? listSessionsAtRef(repoPath, ref) : listSessions(repoPath);
    }
  );
  ipcMain.handle(
    "sessions:get",
    async (_e, repoId, id, ref) => {
      const repoPath = repoOrThrow(repoId).path;
      return ref ? getSessionAtRef(repoPath, ref, id) : getSession(repoPath, id);
    }
  );
  ipcMain.handle(
    "sessions:remove",
    async (_e, repoId, id) => deleteSession(repoOrThrow(repoId).path, id)
  );
  ipcMain.handle(
    "sessions:clear",
    async (_e, repoId) => clearSessions(repoOrThrow(repoId).path)
  );
  ipcMain.handle(
    "sessions:count",
    async (_e, repoId, ref) => {
      const repoPath = repoOrThrow(repoId).path;
      return ref ? countSessionsAtRef(repoPath, ref) : countSessions(repoPath);
    }
  );
  ipcMain.handle("sessions:watch", (e, repoId) => {
    if (repoId) setSessionWatch(e.sender, repoId);
    else clearSessionWatch(e.sender.id);
  });
  ipcMain.handle("sessions:unwatch", (e) => clearSessionWatch(e.sender.id));
  ipcMain.handle(
    "comments:list",
    async (_e, repoId, contextKey) => listCommentsForContext(repoOrThrow(repoId).path, contextKey)
  );
  ipcMain.handle(
    "comments:add",
    async (_e, repoId, input) => {
      const comment = await addComment(repoOrThrow(repoId).path, input);
      bumpStat(repoId, "commentsWritten");
      return comment;
    }
  );
  ipcMain.handle(
    "comments:edit",
    async (_e, repoId, id, body) => editComment(repoOrThrow(repoId).path, id, body)
  );
  ipcMain.handle(
    "comments:resolve",
    async (_e, repoId, id, resolver, sessionId) => resolveComment(repoOrThrow(repoId).path, id, resolver, sessionId ?? null)
  );
  ipcMain.handle(
    "comments:unresolve",
    async (_e, repoId, id) => unresolveComment(repoOrThrow(repoId).path, id)
  );
  ipcMain.handle(
    "comments:remove",
    async (_e, repoId, id) => deleteComment(repoOrThrow(repoId).path, id)
  );
  ipcMain.handle("comments:watch", (e, repoId) => {
    if (repoId) setCommentWatch(e.sender, repoId);
    else clearCommentWatch(e.sender.id);
  });
  ipcMain.handle("comments:unwatch", (e) => clearCommentWatch(e.sender.id));
  ipcMain.handle(
    "tasks:list",
    async (_e, repoId, branch, ref) => {
      const repoPath = repoOrThrow(repoId).path;
      return ref ? listTasksAtRef(repoPath, branch, ref) : listTasks(repoPath, branch);
    }
  );
  ipcMain.handle(
    "tasks:add",
    async (_e, repoId, branch, input) => addTask(repoOrThrow(repoId).path, branch, input)
  );
  ipcMain.handle(
    "tasks:update",
    async (_e, repoId, branch, id, patch) => updateTask(repoOrThrow(repoId).path, branch, id, patch)
  );
  ipcMain.handle(
    "tasks:setDone",
    async (_e, repoId, branch, id, done, actor) => setTaskDone(repoOrThrow(repoId).path, branch, id, done, actor)
  );
  ipcMain.handle(
    "tasks:remove",
    async (_e, repoId, branch, id) => removeTask(repoOrThrow(repoId).path, branch, id)
  );
  ipcMain.handle(
    "tasks:reorder",
    async (_e, repoId, branch, ids) => reorderTasks(repoOrThrow(repoId).path, branch, ids)
  );
  ipcMain.handle(
    "tasks:clear",
    async (_e, repoId, branch) => clearTasks(repoOrThrow(repoId).path, branch)
  );
  ipcMain.handle("tasks:watch", (e, repoId) => {
    if (repoId) setTaskWatch(e.sender, repoId);
    else clearTaskWatch(e.sender.id);
  });
  ipcMain.handle("tasks:unwatch", (e) => clearTaskWatch(e.sender.id));
  ipcMain.handle(
    "aiConfig:status",
    async (_e, repoId) => getAiConfigStatus(repoOrThrow(repoId).path)
  );
  ipcMain.handle(
    "aiConfig:apply",
    async (_e, repoId, request) => applyAiConfig(repoOrThrow(repoId).path, request)
  );
  ipcMain.handle(
    "aiConfig:remove",
    async (_e, repoId, item) => removeAiConfig(repoOrThrow(repoId).path, item)
  );
  ipcMain.handle(
    "commitMessage:detect",
    async (_e, force) => {
      if (force) clearHarnessAuthCache();
      const status = await detectCommitMessageHarnesses();
      void warmCommitMessageModels(status);
      return status;
    }
  );
  ipcMain.handle(
    "commitMessage:generate",
    async (e, repoId, request) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      return generateCommitMessage(repoOrThrow(repoId).path, request, {
        onProgress: (event) => {
          if (win) sendToWindow(win, "commitMessage:progress", event);
        }
      });
    }
  );
  ipcMain.handle(
    "commitMessage:cancel",
    async () => cancelCommitMessageGeneration()
  );
  ipcMain.handle(
    "commitMessage:listModels",
    async (_e, harness) => listCommitMessageModels(harness)
  );
}
let branchState = {
  hasRepo: false,
  defaultBranch: "main",
  onDefaultBranch: false,
  hasChanges: false,
  hasGithub: false,
  hasUpstream: false,
  branchPRNumber: null
};
let repoState = {
  hasRepo: false,
  hasRemote: false,
  canPush: false,
  hasGithub: false,
  editorLabel: null,
  terminalLabel: null,
  revealLabel: "Show in Finder"
};
function sendBranchAction(action) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send("menu:branch-action", action);
}
function sendRepositoryAction(action) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send("menu:repository-action", action);
}
function sendHelpAction(action) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send("menu:help-action", action);
}
function buildHelpSubmenu() {
  return [
    {
      label: "Send Feedback…",
      accelerator: MENU_ACCELERATORS.sendFeedback.accelerator,
      click: () => sendHelpAction("sendFeedback")
    }
  ];
}
function buildRepositorySubmenu() {
  const s = repoState;
  const item = (label, action, enabled, accelerator) => ({
    label,
    enabled,
    accelerator,
    click: () => sendRepositoryAction(action)
  });
  return [
    // Push is gated on there actually being commits to push so ⌘P is inert on an
    // up-to-date branch. Pull/Fetch stay on `hasRemote`: how far behind the
    // branch is isn't known until a fetch, so gating them would be wrong.
    item("Push", "push", s.hasRepo && s.hasRemote && s.canPush, MENU_ACCELERATORS.push.accelerator),
    item("Pull", "pull", s.hasRepo && s.hasRemote, MENU_ACCELERATORS.pull.accelerator),
    item("Fetch", "fetch", s.hasRepo && s.hasRemote, MENU_ACCELERATORS.fetch.accelerator),
    { type: "separator" },
    item("Remove…", "remove", s.hasRepo, MENU_ACCELERATORS.removeRepo.accelerator),
    { type: "separator" },
    item("View on GitHub", "viewOnGithub", s.hasRepo && s.hasGithub, MENU_ACCELERATORS.viewOnGithub.accelerator),
    ...s.terminalLabel ? [
      item(
        `Open in ${s.terminalLabel}`,
        "openInTerminal",
        s.hasRepo,
        MENU_ACCELERATORS.openInTerminal.accelerator
      )
    ] : [],
    item(s.revealLabel, "showInFinder", s.hasRepo, MENU_ACCELERATORS.showInFinder.accelerator),
    ...s.editorLabel ? [item(`Open in ${s.editorLabel}`, "openInEditor", s.hasRepo, MENU_ACCELERATORS.openInEditor.accelerator)] : [],
    { type: "separator" },
    item(
      "Create Issue on GitHub",
      "createIssue",
      s.hasRepo && s.hasGithub,
      MENU_ACCELERATORS.createIssue.accelerator
    ),
    { type: "separator" },
    item("Clean Up Local Branches…", "cleanupBranches", s.hasRepo),
    item("Repository Settings…", "settings", s.hasRepo)
  ];
}
function buildBranchSubmenu() {
  const s = branchState;
  const branchAction = (label, action, enabled, accelerator) => ({
    label,
    enabled,
    accelerator,
    click: () => sendBranchAction(action)
  });
  return [
    branchAction("New Branch…", "newBranch", s.hasRepo, MENU_ACCELERATORS.newBranch.accelerator),
    { type: "separator" },
    branchAction(
      `Update from ${s.defaultBranch}`,
      "updateFromDefault",
      s.hasRepo && !s.onDefaultBranch,
      MENU_ACCELERATORS.updateFromDefault.accelerator
    ),
    // Only forks have an upstream — hide the item entirely otherwise so the
    // menu matches the repo, like GitHub Desktop.
    ...s.hasUpstream ? [branchAction(`Update from upstream/${s.defaultBranch}`, "updateFromUpstream", s.hasRepo)] : [],
    branchAction(
      "Delete Branch…",
      "deleteBranch",
      s.hasRepo && !s.onDefaultBranch,
      MENU_ACCELERATORS.deleteBranch.accelerator
    ),
    { type: "separator" },
    branchAction(
      "Discard All Changes…",
      "discardAll",
      s.hasRepo && s.hasChanges,
      MENU_ACCELERATORS.discardAll.accelerator
    ),
    { type: "separator" },
    branchAction(
      "Preview Pull Request",
      "previewPR",
      s.hasRepo && !s.onDefaultBranch,
      MENU_ACCELERATORS.previewPR.accelerator
    ),
    branchAction(
      s.branchPRNumber ? `View Pull Request #${s.branchPRNumber}` : "Create Pull Request",
      "createPR",
      s.hasRepo && s.hasGithub && !s.onDefaultBranch
    )
  ];
}
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...isMac ? [{ role: "appMenu" }] : [],
    { id: "file", role: "fileMenu" },
    { id: "edit", role: "editMenu" },
    { id: "view", role: "viewMenu" },
    { id: "repository", label: "Repository", submenu: buildRepositorySubmenu() },
    { id: "branch", label: "Branch", submenu: buildBranchSubmenu() },
    { id: "window", role: "windowMenu" },
    { id: "help", role: "help", submenu: buildHelpSubmenu() }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function setupAppMenu() {
  ipcMain.on("menu:setBranchState", (_e, state) => {
    branchState = state;
    buildAppMenu();
  });
  ipcMain.on("menu:setRepositoryState", (_e, state) => {
    repoState = state;
    buildAppMenu();
  });
  buildAppMenu();
}
const { autoUpdater } = electronUpdater;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1e3;
let lastStatus = { state: "idle" };
let pendingVersion = "";
const SIMULATE_UPDATE = !!process.env["SUPER_REVIEW_SIMULATE_UPDATE"];
function pushStatus(status) {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const wc = win.webContents;
    if (wc.isDestroyed() || wc.isCrashed()) continue;
    try {
      wc.send("updater:status", status);
    } catch {
    }
  }
}
let simulationToken = 0;
function runUpdateSimulation() {
  const token = ++simulationToken;
  const version = "9.9.9";
  const total = 84 * 1024 * 1024;
  const speed = 6 * 1024 * 1024;
  const frames = [{ state: "checking" }, { state: "available", version }];
  for (let percent = 0; percent <= 100; percent += 4) {
    frames.push({
      state: "downloading",
      version,
      percent,
      bytesPerSecond: speed,
      transferred: Math.round(percent / 100 * total),
      total
    });
  }
  frames.push({ state: "downloaded", version });
  pendingVersion = version;
  let i = 0;
  const tick = () => {
    if (token !== simulationToken) return;
    if (i >= frames.length) return;
    pushStatus(frames[i++]);
    setTimeout(tick, 350);
  };
  tick();
}
function initAutoUpdates() {
  ipcMain.handle("updater:getVersion", () => app.getVersion());
  ipcMain.handle("updater:getStatus", () => lastStatus);
  ipcMain.handle("updater:check", () => {
    if (SIMULATE_UPDATE && !app.isPackaged) return runUpdateSimulation();
    if (app.isPackaged) {
      void autoUpdater.checkForUpdates();
      return;
    }
    pushStatus({ state: "checking" });
    setTimeout(() => pushStatus({ state: "idle" }), 500);
  });
  ipcMain.handle("updater:quitAndInstall", () => {
    if (app.isPackaged) autoUpdater.quitAndInstall(true, true);
  });
  if (!app.isPackaged) {
    if (SIMULATE_UPDATE) setTimeout(runUpdateSimulation, 2500);
    return;
  }
  autoUpdater.setFeedURL({ provider: "generic", url: `${webBase()}/api/update/` });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.on("checking-for-update", () => pushStatus({ state: "checking" }));
  autoUpdater.on("update-available", (info) => {
    pendingVersion = info.version;
    pushStatus({ state: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => pushStatus({ state: "idle" }));
  autoUpdater.on(
    "download-progress",
    (p) => pushStatus({
      state: "downloading",
      version: pendingVersion,
      percent: Math.round(p.percent),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total
    })
  );
  autoUpdater.on(
    "update-downloaded",
    (info) => pushStatus({ state: "downloaded", version: info.version })
  );
  autoUpdater.on("error", (err) => {
    console.error("[updater] update check failed:", err);
    pushStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
  });
  void autoUpdater.checkForUpdates();
  setInterval(() => void autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
}
const LICENSE_GATE_CODE = "UNLICENSED";
const LICENSE_GATE_MESSAGE = "A valid Super Review license is required.";
const LICENSE_ALLOWED_NAMESPACES = ["license:", "window:", "updater:"];
const LICENSE_ALLOWED_EXACT = /* @__PURE__ */ new Set([
  // Read-only pref fetch so the lock screen can honor theme/zoom.
  "state:getPrefs"
]);
function isLicenseAllowedChannel(channel) {
  if (LICENSE_ALLOWED_EXACT.has(channel)) return true;
  return LICENSE_ALLOWED_NAMESPACES.some((ns) => channel.startsWith(ns));
}
class LicenseGateError extends Error {
  code = LICENSE_GATE_CODE;
  constructor() {
    super(LICENSE_GATE_MESSAGE);
    this.name = "LicenseGateError";
  }
}
let installed = false;
function installLicenseIpcGate() {
  if (installed) return;
  installed = true;
  const realHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((channel, listener) => {
    return realHandle(channel, (event, ...args) => {
      if (!isLicenseAllowedChannel(channel) && !isUnlocked()) throw new LicenseGateError();
      return listener(event, ...args);
    });
  });
  const realOn = ipcMain.on.bind(ipcMain);
  ipcMain.on = ((channel, listener) => {
    return realOn(channel, (event, ...args) => {
      if (!isLicenseAllowedChannel(channel) && !isUnlocked()) return;
      listener(event, ...args);
    });
  });
}
const PROTOCOL = "super-review";
function handleDeepLink(url) {
  try {
    if (new URL(url).protocol === `${PROTOCOL}:`) focusMainWindow();
  } catch {
  }
}
function focusMainWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}
fixPath();
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env["ELECTRON_RENDERER_URL"];
const devIconPath = path.join(__dirname$1, "../../build/icon.png");
const HEADER_HEIGHT = 44;
const BUTTON_DIAMETER = 12;
const BUTTON_INSET_X = 19;
const BUTTON_OPTICAL_NUDGE_Y = -2;
function trafficLightPositionFor(zoom) {
  return {
    x: Math.round(BUTTON_INSET_X * zoom),
    y: Math.round(HEADER_HEIGHT * zoom / 2 - BUTTON_DIAMETER / 2 + BUTTON_OPTICAL_NUDGE_Y)
  };
}
function alignWindowButtons(win) {
  if (process.platform !== "darwin" || win.isDestroyed()) return;
  win.setWindowButtonPosition(trafficLightPositionFor(win.webContents.getZoomFactor()));
}
function windowDimension(value, min, fallback) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(min, Math.floor(value));
}
function createWindow() {
  const prefs = getPrefs();
  const width = windowDimension(
    prefs.windowWidth,
    WINDOW_BOUNDS.minWidth,
    WINDOW_BOUNDS.defaultWidth
  );
  const height = windowDimension(
    prefs.windowHeight,
    WINDOW_BOUNDS.minHeight,
    WINDOW_BOUNDS.defaultHeight
  );
  const isWin = process.platform === "win32";
  const win = new BrowserWindow({
    width,
    height,
    minWidth: WINDOW_BOUNDS.minWidth,
    minHeight: WINDOW_BOUNDS.minHeight,
    // Open centered on the current display (we never restore a saved x/y, so
    // without this the OS could place it by cascade rather than centered).
    center: true,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : isWin ? "hidden" : "default",
    // Baseline (zoom 1) so the buttons are centered on first paint; zoom changes
    // recompute this via alignWindowButtons.
    ...process.platform === "darwin" ? { trafficLightPosition: trafficLightPositionFor(1) } : {},
    ...isWin ? { titleBarOverlay: titleBarOverlayFor(prefs.theme) } : {},
    backgroundColor: "#0a0a0a",
    // macOS ignores the window icon (it uses the dock/bundle icon, set below);
    // Windows/Linux pick up the window + taskbar icon from here in dev.
    ...isDev && process.platform !== "darwin" ? { icon: devIconPath } : {},
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });
  if (prefs.startMaximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.webContents.on("zoom-changed", () => alignWindowButtons(win));
  ipcMain.on("window:syncControls", (e) => {
    if (e.sender === win.webContents) alignWindowButtons(win);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(path.join(__dirname$1, "../renderer/index.html"));
  }
}
function setupPermissions() {
  const ses = session.defaultSession;
  const allowed = /* @__PURE__ */ new Set(["clipboard-sanitized-write"]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    focusMainWindow();
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
  if (isDev && process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
  void app.whenReady().then(async () => {
    if (isDev && process.platform === "darwin") {
      const img = nativeImage.createFromPath(devIconPath);
      if (!img.isEmpty()) app.dock?.setIcon(img);
    }
    setupPermissions();
    await initLicenseService();
    installLicenseIpcGate();
    registerGitCredentials();
    registerIpc();
    setupAppMenu();
    setupWindowChromeIpc();
    createWindow();
    const coldLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (coldLink) handleDeepLink(coldLink);
    startLicenseBackgroundWork();
    initAutoUpdates();
    setTimeout(() => void warmCommitMessageModels(), 3e3);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  flushStore();
});
