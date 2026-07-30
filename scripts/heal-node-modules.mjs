#!/usr/bin/env node
/**
 * heal-node-modules.mjs
 *
 * This sandbox kills long-running shell commands at a hard 45s wall-clock
 * cap. `npm install` on this repo takes several minutes, so every
 * chunked/resumed run risks SIGKILL landing mid-write of a package file
 * (native .node addon, a .mjs/.d.ts build output, etc). npm's own resume
 * logic only checks "does this directory exist", not "is it complete", so
 * a torn write is silently treated as a successful install and never
 * retried -- symptoms show up much later as ENOTEMPTY on the next install,
 * "Bus error (core dumped)" loading a corrupt native binary (rollup,
 * lightningcss, tailwindcss-oxide, @napi-rs/canvas), or tsc/vitest
 * "Cannot find module .../dist/whatever.mjs" for a torn JS package.
 *
 * This script scans an already-installed node_modules for that damage and
 * repairs it by re-fetching just the broken packages with `npm pack`
 * (registry tarball, no arborist/dependency-tree resolution involved, so
 * it can't hit the "Invalid Version" arborist crash that a plain
 * `npm install <pkg>` retry can trigger on a half-broken tree) and
 * extracting straight over the corrupt directory.
 *
 * Usage:
 *   node scripts/heal-node-modules.mjs [node_modules_path]
 *
 * Defaults to ./node_modules (resolves symlinks, e.g. the
 * repo/node_modules -> /tmp/litlit-build/node_modules swap used when the
 * repo's own mounted node_modules dir is unwritable in-place).
 *
 * Exit code 0 if clean or fully repaired, 1 if something couldn't be
 * fixed automatically (falls back to whack-a-mole: read the printed repro,
 * run `npm pack <pkg>@<version>` by hand, extract over the directory).
 */

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const nmArg = process.argv[2] || "node_modules";
const NM = fs.realpathSync(path.resolve(nmArg));

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function normRel(p) {
  if (!p.startsWith("./") && !p.startsWith("/")) return "./" + p;
  return p;
}

function collectExportFiles(exp, out) {
  if (typeof exp === "string") {
    if (exp.startsWith("./") && !exp.includes("*")) out.add(exp);
  } else if (Array.isArray(exp)) {
    for (const v of exp) collectExportFiles(v, out);
  } else if (exp && typeof exp === "object") {
    for (const v of Object.values(exp)) collectExportFiles(v, out);
  }
}

// Heuristics tuned against real false positives seen in this sandbox:
// - "main"/"module"/"typings" values with no extension (node resolves
//   "./index" -> "./index.js" etc) are NOT checked file-for-file; instead
//   we check the family of plausible resolved names.
// - "@types/*" packages legitimately ship main: "" (type-only, no JS).
// - Some packages intentionally point "types"/"main" at a bare directory
//   name with no extension -- resolveCandidates covers common suffixes.
function resolveCandidates(p) {
  if (path.extname(p)) return [p];
  return [p, p + ".js", p + ".mjs", p + ".cjs", p + ".d.ts", p + "/index.js"];
}

function fileExistsAny(dir, candidates) {
  return candidates.some((c) => {
    try {
      return fs.statSync(path.join(dir, c)).isFile();
    } catch {
      return false;
    }
  });
}

// Some packages (pnpm's bundled reflink addons, e.g.) ship prebuilt .node
// binaries for EVERY os/arch combo directly inside their own dist folder,
// not as separate optionalDependencies the way @napi-rs/canvas does. Only
// the one matching this machine is ever loaded; the rest are legitimately
// foreign and SHOULD fail to require() -- that's not corruption, so don't
// load-test a .node file whose own name plainly says it's for a different
// platform/arch than the one actually running this script.
const OTHER_PLATFORM_TAGS = ["darwin", "win32", "freebsd", "sunos", "aix", "android"].filter(
  (t) => t !== process.platform,
);
const OTHER_ARCH_TAGS = ["arm64", "ia32", "arm", "riscv64", "s390x", "mips", "ppc64"].filter(
  // prefix-aware in both directions so e.g. the generic "arm" tag isn't
  // treated as foreign when actually running on arm64 (and vice versa)
  (t) => t !== process.arch && !t.startsWith(process.arch) && !process.arch.startsWith(t),
);
function isForeignPlatformBinary(file) {
  const base = path.basename(file).toLowerCase();
  return (
    OTHER_PLATFORM_TAGS.some((tag) => base.includes(tag)) ||
    OTHER_ARCH_TAGS.some((tag) => base.includes(tag))
  );
}

function checkPkg(dir) {
  const pj = path.join(dir, "package.json");
  if (!fs.existsSync(pj)) return "MISSING package.json";
  const data = readJson(pj);
  if (!data) return "unparseable package.json";

  const missing = [];
  for (const key of ["main", "module", "types", "typings"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim() !== "") {
      const rel = normRel(v);
      if (!fileExistsAny(dir, resolveCandidates(rel))) missing.push(`${key}=${v}`);
    }
  }
  if (data.exports) {
    const files = new Set();
    collectExportFiles(data.exports, files);
    for (const f of files) {
      if (f === "./package.json") continue;
      if (!fs.existsSync(path.join(dir, f))) missing.push(f);
    }
  }
  // Native addon sanity, two layers:
  // 1) a .node file under 100KB is almost certainly a torn write (real
  //    prebuilt binaries for this stack run 300KB-4MB+) -- cheap, no
  //    subprocess needed, catches the obvious case fast.
  // 2) load-test every .node file (regardless of size) in a child process.
  //    Proven necessary 2026-07-29: @napi-rs/canvas's skia.linux-x64-gnu.node
  //    landed at 6.1MB (real published size 33.4MB) -- plausible-looking,
  //    comfortably over the 100KB floor, but still a torn write that
  //    SIGBUSes ("Bus error (core dumped)") on require(), which is NOT a
  //    catchable JS exception -- it silently killed every vitest worker
  //    process with no useful error (tinypool only ever sees "Worker exited
  //    unexpectedly"), costing a full debugging pass to trace back to this
  //    file. A child-process load-test surfaces it directly: the crash
  //    kills the CHILD, execFileSync just throws in the (unaffected) parent
  //    script, so this is safe to run unconditionally.
  for (const entry of walkShallow(dir)) {
    if (entry.endsWith(".node")) {
      let sz;
      try {
        sz = fs.statSync(entry).size;
      } catch {
        continue;
      }
      if (sz < 100_000) {
        missing.push(`truncated native addon (${sz}B): ${entry}`);
        continue; // already flagged; no need to also load-test it
      }
      if (isForeignPlatformBinary(entry)) continue; // not meant to load here
      try {
        execFileSync(process.execPath, ["-e", "require(process.argv[1])", entry], {
          stdio: "ignore",
          timeout: 10_000,
        });
      } catch (e) {
        const how = e.signal ? `killed by ${e.signal}` : `exit ${e.status}`;
        missing.push(`native addon fails to load (${how}, ${sz}B): ${entry}`);
      }
    }
  }
  return missing.length ? missing : null;
}

function walkShallow(dir, depth = 2) {
  const out = [];
  function rec(d, remaining) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isFile()) out.push(full);
      else if (e.isDirectory() && remaining > 0) rec(full, remaining - 1);
    }
  }
  rec(dir, depth);
  return out;
}

function listPackages(nm) {
  const pkgs = [];
  for (const e of fs.readdirSync(nm)) {
    if (e === ".bin" || e.startsWith(".")) continue;
    const p = path.join(nm, e);
    if (!fs.statSync(p).isDirectory()) continue;
    if (e.startsWith("@")) {
      for (const e2 of fs.readdirSync(p)) {
        const p2 = path.join(p, e2);
        if (fs.statSync(p2).isDirectory()) pkgs.push({ name: `${e}/${e2}`, dir: p2 });
      }
    } else {
      pkgs.push({ name: e, dir: p });
    }
  }
  return pkgs;
}

console.log(`Scanning ${NM} ...`);
const broken = [];
for (const { name, dir } of listPackages(NM)) {
  const r = checkPkg(dir);
  if (r) broken.push({ name, dir, reasons: r });
}

if (broken.length === 0) {
  console.log("node_modules looks structurally sound. Nothing to repair.");
  process.exit(0);
}

console.log(`Found ${broken.length} suspect package(s):`);
for (const b of broken) console.log(`  - ${b.name}: ${JSON.stringify(b.reasons).slice(0, 200)}`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heal-nm-"));
console.log(`\nRefetching via npm pack into ${tmpDir} ...`);

const specs = [];
for (const b of broken) {
  const pj = readJson(path.join(b.dir, "package.json"));
  const version = pj && pj.version;
  if (!version) {
    console.log(`  ! ${b.name}: no readable version, skipping (manual fix needed)`);
    continue;
  }
  specs.push({ name: b.name, version, dir: b.dir });
}

if (specs.length === 0) {
  console.log("Nothing packable automatically. Manual repair required.");
  process.exit(1);
}

const packArgs = specs.map((s) => `"${s.name}@${s.version}"`).join(" ");
try {
  execSync(`npm pack ${packArgs} --silent`, { cwd: tmpDir, stdio: "inherit" });
} catch (e) {
  console.error("npm pack failed:", e.message);
  process.exit(1);
}

let ok = 0;
let fail = [];
for (const s of specs) {
  const base = s.name.startsWith("@") ? s.name.slice(1).replace("/", "-") : s.name;
  const tgz = path.join(tmpDir, `${base}-${s.version}.tgz`);
  if (!fs.existsSync(tgz)) {
    fail.push(`${s.name}: expected tarball ${tgz} not found`);
    continue;
  }
  try {
    fs.rmSync(s.dir, { recursive: true, force: true });
    fs.mkdirSync(s.dir, { recursive: true });
    execSync(`tar -xzf "${tgz}" -C "${s.dir}" --strip-components=1`);
    ok++;
  } catch (e) {
    fail.push(`${s.name}: ${e.message}`);
  }
}

console.log(`\nRepaired ${ok}/${specs.length}.`);
if (fail.length) {
  console.log("Failures:");
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}

console.log("Done. Re-run `npm run check` and `npm test` to confirm.");
process.exit(0);
