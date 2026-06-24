#!/usr/bin/env node
// codemod.mjs — line-ending-safe mass string/regex replacement across a tree.
//
// Usage:
//   node codemod.mjs --dir src --ext .ts        --from "from 'pkg/src/x'" --to "from 'pkg'"
//   node codemod.mjs --dir src --ext .spec.ts   --regex "\basync\(" --to "waitForAsync("
//   add --dry to preview without writing.
//
// Why this exists: on Windows, `sed -i` (and most stream editors) rewrite EVERY
// scanned file's line endings to LF — even files with no match — which with
// core.autocrlf=true turns into thousands of spurious CRLF/LF diffs (see T8).
// This reads a file, replaces only the matched substrings, and writes the file
// back unchanged everywhere else, so untouched bytes (including CRLF endings)
// are preserved and `git status` shows only real changes.

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function opt(name, def = undefined) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : def;
}
const flag = (name) => argv.includes(`--${name}`);

const dir = path.resolve(opt('dir', 'src'));
const ext = opt('ext', '.ts');
const fromLiteral = opt('from');
const fromRegex = opt('regex');
const to = opt('to');
const dry = flag('dry');

if ((!fromLiteral && !fromRegex) || to === undefined) {
  console.error('Usage: node codemod.mjs --dir <dir> --ext <ext> (--from <literal> | --regex <pattern>) --to <replacement> [--dry]');
  process.exit(2);
}

const matcher = fromRegex
  ? new RegExp(fromRegex, 'g')
  : new RegExp(fromLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

function walk(d, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.angular', 'coverage'].includes(e.name)) continue;
      walk(full, out);
    } else if (e.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

let changedFiles = 0;
let totalReplacements = 0;
for (const file of walk(dir)) {
  const content = fs.readFileSync(file, 'utf8');
  let count = 0;
  const next = content.replace(matcher, (m) => {
    count++;
    return to;
  });
  if (count > 0) {
    changedFiles++;
    totalReplacements += count;
    if (!dry) fs.writeFileSync(file, next); // preserves untouched bytes / line endings
    console.log(`${dry ? '[dry] ' : ''}${path.relative(process.cwd(), file)} (${count})`);
  }
}

console.log(`\n${dry ? 'Would change' : 'Changed'} ${changedFiles} file(s), ${totalReplacements} replacement(s).`);
if (dry) console.log('Re-run without --dry to apply.');
