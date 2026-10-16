#!/usr/bin/env node
// Fails if a migration that exists at <base> was changed or removed (CLAUDE.md: never edit a
// shipped migration, append a new one). Usage: node scripts/check-migrations.mjs <base-commit>
//   - server: every file in apps/server/migrations at <base> must be unchanged
//   - app: every entry of MIGRATIONS in apps/mobile/src/db/schema.ts at <base> must be unchanged
import { execFileSync } from 'node:child_process';

const base = process.argv[2];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

if (!base || /^0+$/.test(base)) {
  console.log('No base commit; skipping the migration check.');
  process.exit(0);
}
try {
  git('cat-file', '-e', `${base}^{commit}`);
} catch {
  console.log(`Base ${base} isn't in this clone (e.g. after a force push); skipping the migration check.`);
  process.exit(0);
}

const problems = [];

const SERVER = 'apps/server/migrations';
const changed = git('diff', '--name-status', '--diff-filter=MDR', base, 'HEAD', '--', SERVER).trim();
if (changed) problems.push(`Server migrations changed or removed:\n${changed}`);

const SCHEMA = 'apps/mobile/src/db/schema.ts';
const migrations = (source) => {
  // Line endings depend on the checkout (CRLF on Windows), not on the migration.
  const list = source.replace(/\r\n/g, '\n').match(/const MIGRATIONS[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!list) throw new Error(`Couldn't find the MIGRATIONS array in ${SCHEMA}`);
  return [...list[1].matchAll(/`([^`]*)`/g)].map((m) => m[1]);
};
let before = [];
try {
  before = migrations(git('show', `${base}:${SCHEMA}`));
} catch (err) {
  if (!/does not exist|exists on disk, but not in/.test(String(err))) throw err;
}
const after = migrations(git('show', `HEAD:${SCHEMA}`));
before.forEach((sql, i) => {
  if (after[i] !== sql) problems.push(`App migration ${i + 1} in ${SCHEMA} was ${after[i] === undefined ? 'removed' : 'changed'}.`);
});

if (problems.length > 0) {
  console.error(`${problems.join('\n\n')}\n\nShipped migrations must not change: append a new one instead.`);
  process.exit(1);
}
console.log(`Migrations OK (compared with ${/^[0-9a-f]{40}$/.test(base) ? base.slice(0, 7) : base}).`);
