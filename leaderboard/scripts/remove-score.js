#!/usr/bin/env node
// Remove a leaderboard entry (all-time, weekly and daily), and optionally ban its
// player id so it cannot post again.
//
//   npm run remove-score -- <name or player id> [--ban] [--local]
//
//   SwiftOtter482          the name shown on the board
//   --ban                  also block the player id (use for forged scores;
//                          leave it off when a player asks for deletion)
//   --local                act on the local dev database instead of production
//
// Names are not unique. If several players share the name, the matches are
// listed and nothing is changed: run it again with the id of the one you mean.
import { execFileSync } from "node:child_process";

const DB_NAME = "horde-leaderboard"; // database_name in wrangler.jsonc
const ID_RE = /^[0-9a-f]{32}$/;
const NAME_RE = /^[A-Za-z]{1,30}[0-9]{1,3}$/;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const targets = args.filter((a) => !a.startsWith("--"));
const ban = flags.delete("--ban");
const local = flags.delete("--local");
const target = targets[0];
const byId = ID_RE.test(target || "");

// The target goes into SQL text (wrangler takes no bound parameters), so it
// must match one of the two strict patterns above.
if (targets.length !== 1 || flags.size > 0 || !(byId || NAME_RE.test(target))) {
  console.error("Usage: npm run remove-score -- <name or player id> [--ban] [--local]");
  process.exit(2);
}

function sql(command) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB_NAME, local ? "--local" : "--remote", "--json", "--command", command],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" }
  );
  return JSON.parse(out)[0].results;
}

const where = local ? "local" : "production";
const rows = sql(
  `SELECT id, name, best, wave, updated_at FROM players WHERE ${byId ? "id" : "name"} = '${target}' ORDER BY best DESC`
);
for (const r of rows) {
  console.log(`${r.id}  ${r.name}  score ${r.best}  wave ${r.wave}  ${new Date(r.updated_at).toISOString()}`);
}

if (rows.length > 1) {
  console.error(`\n${rows.length} players share the name ${target}. Nothing changed; run again with one of the ids above.`);
  process.exit(1);
}
if (rows.length === 0 && !(byId && ban)) {
  console.error(`No entry for ${target} in the ${where} database. Nothing changed.`);
  process.exit(1);
}

const id = rows.length ? rows[0].id : target;
const statements = ["players", "weekly", "daily"].map((table) => `DELETE FROM ${table} WHERE id = '${id}'`);
if (ban) statements.unshift(`INSERT OR IGNORE INTO banned (id, banned_at) VALUES ('${id}', ${Date.now()})`);
sql(statements.join("; "));

const removed = rows.length ? "Removed the entry" : "There was no entry to remove";
const banned = ban ? (rows.length ? " and banned the player id" : "; banned the player id") : "";
console.log(`${removed}${banned} (${where} database).`);
