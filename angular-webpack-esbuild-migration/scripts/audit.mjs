#!/usr/bin/env node
// audit.mjs — read-only inventory for an Angular webpack -> esbuild migration.
//
// Usage:
//   node audit.mjs [projectRoot] [--json]
//
// Prints a report of everything that determines which migration steps apply.
// Makes NO changes. Run it from (or point it at) the Angular project root —
// the directory that contains angular.json.
//
// Dependency-free: uses only Node built-ins, so it runs anywhere Node runs
// (the Angular toolchain guarantees a Node runtime is present).

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');

/** Recursively collect files under dir, skipping noise directories. */
function walk(dir, filter, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.angular', 'coverage'].includes(e.name)) continue;
      walk(path.join(dir, e.name), filter, out);
    } else if (filter(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function readJson(p) {
  const raw = read(p);
  if (raw == null) return null;
  try {
    // tsconfig files allow comments/trailing commas; strip them best-effort.
    const cleaned = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

const report = {};
const lines = [];
const push = (s = '') => lines.push(s);
const srcDir = path.join(root, 'src');
const tsFiles = walk(srcDir, (n) => n.endsWith('.ts') && !n.endsWith('.d.ts'));
const styleFiles = walk(srcDir, (n) => n.endsWith('.scss') || n.endsWith('.css'));
const specFiles = tsFiles.filter((f) => f.endsWith('.spec.ts'));

push('# Angular webpack -> esbuild migration audit');
push(`Project root: ${root}`);
push('');

// 1 + 8. Per-project builders, outputPath, dead options ----------------------
// Scans EVERY project in the workspace (not just the first) so multi-project
// repos are handled. Application projects on a webpack builder are the ones to
// migrate; library projects (ng-packagr) are reported and skipped.
const angular = readJson(path.join(root, 'angular.json'));
let appliesToProject = false;
report.projects = [];
if (!angular) {
  push('1. Builder: angular.json not found or unparseable — run this from the workspace root.');
  report.builder = null;
} else {
  const names = Object.keys(angular.projects ?? {});
  push(`1. Projects in workspace: ${names.length}`);
  for (const projName of names) {
    const project = angular.projects[projName] ?? {};
    const arch = project.architect ?? project.targets ?? {};
    const build = arch.build ?? {};
    const builder = build.builder ?? '(none)';
    const type = project.projectType ?? (/ng-packagr/.test(builder) ? 'library' : 'application');
    const isLib = type === 'library' || /ng-packagr/.test(builder);
    const webpacky = /webpack/i.test(builder);
    if (webpacky && !isLib) appliesToProject = true;
    const out = build.options?.outputPath;
    const removed = ['namedChunks', 'vendorChunk', 'buildOptimizer', 'aot', 'es5BrowserSupport'].filter(
      (k) => k in (build.options ?? {})
    );
    report.projects.push({ name: projName, type, builder, outputPath: out, deadBuildOptions: removed });

    push(`   - ${projName} [${type}]: ${builder}`);
    if (isLib) {
      push('     library project — built with ng-packagr; SKIP (no webpack->esbuild change).');
      continue;
    }
    push(`     ${webpacky ? 'APPLIES — webpack-based builder; migrate this project.' : 'not on a webpack builder.'}`);
    if (out !== undefined) {
      const outStr = typeof out === 'string' ? `"${out}" (string form)` : JSON.stringify(out);
      push(`     outputPath: ${outStr}`);
      if (typeof out === 'string') {
        push('     WARNING: string form makes the application builder emit into <outputPath>/browser/ (T6).');
        push('     If a backend serves the base path, use { "base": "...", "browser": "" }.');
      }
    }
    if (removed.length) push(`     Options unsupported by the application builder (remove): ${removed.join(', ')}`);
  }
  // back-compat single-project fields
  const firstApp = report.projects.find((p) => p.type !== 'library');
  report.project = firstApp?.name ?? names[0];
  report.builder = firstApp?.builder ?? null;
  report.outputPath = firstApp?.outputPath;
}

// 2. webpack config ----------------------------------------------------------
push('');
const webpackPath = ['webpack.config.js', 'webpack.config.ts', 'custom-webpack.config.js'].find((f) =>
  fs.existsSync(path.join(root, f))
);
report.webpackConfig = webpackPath ?? null;
if (webpackPath) {
  const wp = read(path.join(root, webpackPath)) ?? '';
  const plugins = [...wp.matchAll(/new\s+([A-Za-z0-9_]+Plugin)/g)].map((m) => m[1]);
  const loaders = [...wp.matchAll(/['"]([a-z0-9@/-]+-loader)['"]/g)].map((m) => m[1]);
  report.webpackPlugins = [...new Set(plugins)];
  report.webpackLoaders = [...new Set(loaders)];
  push(`2. webpack config: ${webpackPath}`);
  if (plugins.length) push(`   Plugins: ${[...new Set(plugins)].join(', ')} — map each to an esbuild equivalent (see guide).`);
  if (loaders.length) push(`   Loaders: ${[...new Set(loaders)].join(', ')}`);
  if (!plugins.length && !loaders.length) push('   (no plugins/loaders matched — inspect it manually)');
} else {
  push('2. webpack config: none found.');
}

// 3. ES5 / IE legacy configs -------------------------------------------------
push('');
const es5Files = walk(root, (n) => /tsconfig-es5/.test(n));
report.es5Configs = es5Files.map((f) => path.relative(root, f));
const es5InAngular = angular ? JSON.stringify(angular).includes('es5') : false;
push(`3. ES5/IE configs: ${es5Files.length} tsconfig-es5* file(s)${es5InAngular ? ', and "es5" referenced in angular.json' : ''}`);
es5Files.forEach((f) => push(`   - ${path.relative(root, f)} (delete; remove its es5 config blocks)`));

// 4. Legacy polyfills --------------------------------------------------------
push('');
const polyPath = path.join(srcDir, 'polyfills.ts');
const poly = read(polyPath);
if (poly == null) {
  push('4. src/polyfills.ts: not found.');
  report.legacyPolyfills = null;
} else {
  const hits = (poly.match(/core-js|formdata-polyfill|regenerator-runtime|^\s*import .*['"]process['"]|window\['process'\]/gm) || []).length;
  const hasZoneTesting = /zone\.js\/testing/.test(poly);
  report.legacyPolyfills = hits;
  report.zoneTestingInPolyfills = hasZoneTesting;
  push(`4. src/polyfills.ts: ${hits} legacy polyfill import(s) to remove (core-js / formdata-polyfill / regenerator-runtime / process).`);
  if (hasZoneTesting) push("   WARNING: 'zone.js/testing' is imported here — it belongs only in the test setup file, never in app polyfills.");
}

// 5. SCSS tilde paths --------------------------------------------------------
push('');
const tildeHits = [];
for (const f of styleFiles) {
  const c = read(f) || '';
  const re = /url\(\s*['"]?~|['"]~(assets|node_modules)/g;
  if (re.test(c)) tildeHits.push(path.relative(root, f));
}
report.scssTildePaths = tildeHits;
push(`5. SCSS '~' paths (webpack-only): ${tildeHits.length} file(s).`);
tildeHits.slice(0, 20).forEach((f) => push(`   - ${f}`));
if (tildeHits.length) push('   Replace ~ with a path RELATIVE TO THE SCSS FILE on disk (see T5). Check SCSS variables that build paths too.');

// 6. Internal package imports broken by moduleResolution: bundler ------------
push('');
const internalImportRe = /from\s+['"](@?[\w.-]+(?:\/[\w.-]+)*?\/(?:src|dist)\/[^'"]+)['"]/g;
const internalHits = [];
for (const f of tsFiles) {
  const c = read(f) || '';
  for (const m of c.matchAll(internalImportRe)) {
    // ignore relative imports (./ or ../) — only package imports matter
    if (!m[1].startsWith('.')) internalHits.push({ file: path.relative(root, f), spec: m[1] });
  }
}
report.internalImports = internalHits;
const uniqueSpecs = [...new Set(internalHits.map((h) => h.spec))];
push(`6. Internal package imports (/src/ or /dist/) — broken silently by bundler resolution: ${internalHits.length} import(s) across ${uniqueSpecs.length} path(s).`);
uniqueSpecs.slice(0, 25).forEach((s) => push(`   - ${s}`));
if (internalHits.length) push('   Replace with the package root import; codemod with scripts/codemod.mjs (see T2).');

// 7. Class fields initialized from injected services (TS2729 candidates) -----
push('');
const ts2729 = [];
for (const f of tsFiles) {
  if (f.endsWith('.spec.ts')) continue;
  const c = (read(f) || '').split('\n');
  c.forEach((line, i) => {
    const t = line.trim();
    // Class-field declaration whose initializer reads an injected service:
    //   [modifiers] name[!?][: Type] = this.<member>
    // Field decls (optionally decorated/modified) start with the field name, not
    // with `this.`/`return`/etc. (which would be statements inside a method),
    // and have no `(` before the `=` (which would be a call or arrow params).
    const isFieldDecl =
      /^(@[\w$]+\([^)]*\)\s*)?(private |public |protected |readonly |static |declare |override )*[A-Za-z_$][\w$]*[!?]?\s*(:\s*[^=]+?)?=\s*this\.[A-Za-z_$]/.test(t) &&
      !/^(this\.|return|const|let|var|if|for|while|switch|await)\b/.test(t) &&
      !/\(/.test(t.split('=')[0]);
    if (isFieldDecl && !t.startsWith('//')) {
      ts2729.push(`${path.relative(root, f)}:${i + 1}`);
    }
  });
}
report.ts2729Candidates = ts2729;
push(`7. Class fields initialized from 'this.<service>' (TS2729 candidates): ${ts2729.length}.`);
ts2729.slice(0, 20).forEach((h) => push(`   - ${h}`));
if (ts2729.length) push('   Move initializers into the constructor body (see T4).');

// 7b. Subclass @Input/@Output re-declarations (TS2612 candidates) ------------
// The stricter compiler flags a subclass property that re-declares a base
// property without `declare`. Offline (no build to surface it), this is easy to
// miss, so flag @Input/@Output members that appear inside a class that extends.
push('');
const ts2612 = [];
for (const f of tsFiles) {
  if (f.endsWith('.spec.ts')) continue;
  const lines2 = (read(f) || '').split('\n');
  const extIdx = lines2.findIndex((l) => /\bclass\s+\w+\s+extends\s+/.test(l));
  if (extIdx === -1) continue;
  for (let i = extIdx; i < lines2.length; i++) {
    if (/@(Input|Output)\s*\(/.test(lines2[i]) && !/\bdeclare\b/.test(lines2[i])) {
      ts2612.push(`${path.relative(root, f)}:${i + 1}`);
    }
  }
}
report.ts2612Candidates = ts2612;
push(`7b. @Input/@Output in subclasses (TS2612 candidates — verify each vs its base): ${ts2612.length}.`);
ts2612.slice(0, 20).forEach((h) => push(`   - ${h}`));
if (ts2612.length) push("   If a property re-declares a base-class @Input/@Output, add the 'declare' modifier (see T3).");

// 9. Angular ecosystem version alignment -------------------------------------
push('');
const pkg = readJson(path.join(root, 'package.json'));
report.versionMismatches = [];
if (pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const coreRange = deps['@angular/core'];
  const coreMajor = coreRange ? (coreRange.match(/(\d+)/) || [])[1] : null;
  push(`9. Angular major: ${coreMajor ?? '?'} (@angular/core ${coreRange ?? 'n/a'})`);
  // Version path for the destination builder.
  const maj = coreMajor ? parseInt(coreMajor, 10) : null;
  report.angularMajor = maj;
  if (maj != null) {
    if (maj >= 20) {
      report.targetBuilder = '@angular/build:application';
      push('   Path: target @angular/build:application (or @angular-devkit/build-angular:application).');
    } else if (maj >= 17) {
      report.targetBuilder = '@angular-devkit/build-angular:application';
      push('   Path: target @angular-devkit/build-angular:application (the main path in SKILL.md).');
    } else if (maj === 16) {
      report.targetBuilder = '@angular-devkit/build-angular:browser-esbuild';
      push('   Path: application builder NOT available on 16 — use @angular-devkit/build-angular:browser-esbuild as a stepping stone, then move to :application after upgrading.');
    } else {
      report.targetBuilder = null;
      push(`   Path: esbuild builders do not exist on Angular ${maj}. Upgrade Angular first (ng update), then re-run this audit.`);
    }
  }
  if (coreMajor) {
    const ecosystem = Object.keys(deps).filter((d) => /^@angular\/|^@ngrx\/|^@angular-/.test(d) && !/builders\/custom-webpack/.test(d));
    for (const d of ecosystem) {
      const m = (String(deps[d]).match(/(\d+)/) || [])[1];
      if (m && m !== coreMajor && !/cli|devkit|build-angular/.test(d)) {
        report.versionMismatches.push({ pkg: d, version: deps[d], expectedMajor: coreMajor });
      }
    }
    if (report.versionMismatches.length) {
      push('   Ecosystem packages whose major does not match Angular (fix before clean install):');
      report.versionMismatches.forEach((v) => push(`   - ${v.pkg} ${v.version} (expected major ${v.expectedMajor})`));
    } else {
      push('   Ecosystem package majors look aligned.');
    }
  }
} else {
  push('9. package.json not found.');
}

// 10. zone.js/dist imports in test entry -------------------------------------
push('');
const testTs = read(path.join(srcDir, 'test.ts'));
report.zoneDistImports = testTs ? (testTs.match(/zone\.js\/dist\//g) || []).length : 0;
push(`10. zone.js/dist imports in src/test.ts: ${report.zoneDistImports} (replace all with a single 'zone.js/testing'; see T7).`);

// Spec hygiene: async() and duplicate filenames -----------------------------
push('');
const asyncSpecs = specFiles.filter((f) => /\basync\s*\(/.test(read(f) || '') && /@angular\/core\/testing/.test(read(f) || ''));
report.asyncInSpecs = asyncSpecs.map((f) => path.relative(root, f));
push(`11. spec files using async() from @angular/core/testing (rename to waitForAsync; see T11): ${asyncSpecs.length}.`);

const byBase = {};
for (const f of specFiles) {
  const b = path.basename(f);
  (byBase[b] ||= []).push(path.relative(root, f));
}
const dupes = Object.entries(byBase).filter(([, v]) => v.length > 1);
report.duplicateSpecNames = Object.fromEntries(dupes);
push('');
push(`12. duplicate .spec.ts filenames (Angular Jest builder collides on basename; see T12): ${dupes.length}.`);
dupes.slice(0, 15).forEach(([b, v]) => push(`   - ${b}: ${v.join(' , ')}`));

// Summary --------------------------------------------------------------------
push('');
push('---');
push(`Applies to this project: ${appliesToProject ? 'YES' : 'no/unsure'}. Read SKILL.md, then work Phase 0 -> Phase 1 in order.`);

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  process.stdout.write(lines.join('\n') + '\n');
}
