#!/usr/bin/env node
/**
 * Development auto-commit/auto-push loop.
 *
 * Every INTERVAL seconds (default 60) it:
 *   1. checks `git status --porcelain` for changes (skips if clean — no empty commits)
 *   2. refuses to commit if any staged path looks like a secret (.env, *.pem, ...)
 *   3. stages everything (respecting .gitignore) and commits with a message
 *      derived from the changed files, e.g. "Update geofence lib, admin UI (4 files)"
 *   4. pushes to origin/<current branch>
 *
 * Usage:  npm run autopush            (Ctrl+C to stop)
 *         AUTOPUSH_INTERVAL=120 npm run autopush
 *         npm run autopush -- --once  (single cycle, handy for testing)
 */
import { execFileSync } from "node:child_process";

const INTERVAL_S = Number(process.env.AUTOPUSH_INTERVAL ?? 60);
const ONCE = process.argv.includes("--once");

const SECRET_PATTERNS = [
  /(^|\/)\.env($|\.(?!example$).+)/,
  /\.pem$/,
  /\.key$/,
  /(^|\/)id_rsa/,
  /credentials\.json$/,
  /(^|\/)settings\.local\.json$/, // Claude Code approved-command allowlist (may embed credentials)
];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function log(msg) {
  console.log(`[autopush ${new Date().toLocaleTimeString()}] ${msg}`);
}

/** Map a path to a human-friendly area name for the commit message. */
function areaOf(file) {
  const rules = [
    [/^lib\/geo/, "geofence logic"],
    [/^lib\/validation/, "validation"],
    [/^lib\/(auth|session|password)|^proxy\.ts/, "admin auth"],
    [/^lib\/config/, "configuration"],
    [/^lib\/db|^database\//, "database"],
    [/^app\/api\//, "API routes"],
    [/^app\/admin|^components\/admin/, "admin UI"],
    [/^app\/|^components\//, "registration UI"],
    [/^tests?\/|\.test\.ts$/, "tests"],
    [/^scripts\//, "scripts"],
    [/README|\.md$/, "docs"],
    [/package(-lock)?\.json$/, "dependencies"],
  ];
  for (const [re, name] of rules) if (re.test(file)) return name;
  return "config";
}

function buildMessage(entries) {
  const added = entries.filter((e) => e.status.includes("A") || e.status === "??").length;
  const deleted = entries.filter((e) => e.status.includes("D")).length;
  const areas = [...new Set(entries.map((e) => areaOf(e.file)))].slice(0, 3);
  const verb = added === entries.length ? "Add" : deleted === entries.length ? "Remove" : "Update";
  const n = entries.length;
  return `${verb} ${areas.join(", ")} (${n} file${n === 1 ? "" : "s"})`;
}

function cycle() {
  let porcelain;
  try {
    porcelain = git("status", "--porcelain", "-uall");
  } catch (e) {
    log(`git status failed: ${e.message}`);
    return;
  }
  if (!porcelain) {
    // Nothing to commit (never create empty commits), but retry any push that failed earlier.
    try {
      if (Number(git("rev-list", "--count", "@{u}..HEAD")) > 0) push();
    } catch {
      /* no upstream yet */
    }
    return;
  }

  const entries = porcelain.split("\n").map((line) => ({
    status: line.slice(0, 2).trim(),
    file: line.slice(3).replace(/^"|"$/g, "").split(" -> ").pop(),
  }));

  const leaked = entries.filter((e) => SECRET_PATTERNS.some((re) => re.test(e.file)));
  if (leaked.length) {
    log(`REFUSING to commit possible secrets: ${leaked.map((e) => e.file).join(", ")}`);
    log("Add them to .gitignore, then autopush will resume.");
    return;
  }

  const message = buildMessage(entries);
  try {
    git("add", "-A");
    git("commit", "-m", message);
    log(`committed: ${message}`);
  } catch (e) {
    log(`commit failed: ${e.stderr || e.message}`);
    return;
  }

  push();
}

function push() {
  try {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    git("push", "-u", "origin", branch);
    log(`pushed to origin/${branch}`);
  } catch (e) {
    log(`push failed (will retry next cycle): ${e.stderr || e.message}`);
  }
}

cycle();
if (!ONCE) {
  log(`watching for changes every ${INTERVAL_S}s — Ctrl+C to stop`);
  setInterval(cycle, INTERVAL_S * 1000);
}
