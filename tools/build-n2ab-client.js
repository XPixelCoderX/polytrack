#!/usr/bin/env node
/*
 * build-n2ab-client.js
 *
 * The client bundle ships pre-built and obfuscated (no upstream sources in this
 * repo), so edits are applied as a repeatable transform instead of by hand.
 *
 * It does three things:
 *   1. Rebrands every PolyTraqqq / PolyFly / ptq / pf- token to N2AB Client.
 *   2. Appends tools/ui-polish.css to the panel's shadow-DOM stylesheet.
 *   3. Registers the extra modules defined in tools/modules.js.
 *
 * How the bundle stores strings
 * -----------------------------
 * All literals live in one array, each entry base64-ish encoded with a custom
 * alphabet. At startup the array is rotated until a checksum over nine specific
 * entries equals 0xe681e (348 rotations for this build). Two consequences:
 *
 *   - Those nine checksum entries must stay byte-identical, or the loader spins
 *     forever. They are pinned in CHECKSUM_INDICES below.
 *   - Rewriting an entry's *value* in place is rotation-safe, because indices
 *     are resolved after rotation.
 *
 * Usage:
 *   node tools/build-n2ab-client.js            # write n2ab_client.bundle.js
 *   node tools/build-n2ab-client.js --check    # verify only, no write
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { encode, decode } = require("./obfuscated-string-codec.js");

const ROOT = path.join(__dirname, "..");
const BUNDLE = path.join(ROOT, "n2ab_client.bundle.js");
const CSS_FILE = path.join(__dirname, "ui-polish.css");
const MODULES_FILE = path.join(__dirname, "modules.js");

const CHECKSUM = 0xe681e;
const BASE = 0x14d;

// Entries consumed by the rotation checksum - never rewrite these.
const CHECKSUM_INDICES = [0x60b, 0x4ae, 0x1176, 0xcd7, 0x53b, 0x8a2, 0x1d4, 0x5d0, 0x5f7]
  .map((h) => h - BASE);

// Live endpoints stay on the original host so the updater and logo keep working.
const KEEP_HOST = "polytraqqq.com";
const HOST_TOKEN = "\u0000KEEPHOST\u0000";

// ---------------------------------------------------------------- helpers

function findStringArray(src) {
  const anchor = "function _0x2b4a(){var _0x5d167e=[";
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error("string array not found - bundle layout changed");
  const open = src.indexOf("[", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) {
      return { open, end: i, arr: JSON.parse(src.slice(open, i + 1).replace(/'/g, '"')) };
    }
  }
  throw new Error("unterminated string array");
}

function rebrandText(s) {
  return s
    .split(KEEP_HOST).join(HOST_TOKEN)
    .replace(/__polyFlyCmd/g, "__n2abCmd")
    .replace(/__polyflyWasm/g, "__n2abWasm")
    .replace(/__polyfly/g, "__n2ab")
    .replace(/__ptq/g, "__n2ab")
    .replace(/__pf/g, "__n2ab")
    .replace(/POLYFLY_/g, "N2AB_")
    .replace(/POLYFLY/g, "N2AB")
    .replace(/PTQ_/g, "N2AB_")
    // "PolyTraqqq Cheat Client" would otherwise become "N2AB Client Cheat Client"
    .replace(/PolyTraqqq Cheat Client/g, "N2AB Client")
    .replace(/PolyTraqqq/g, "N2AB Client")
    .replace(/polytraqqq/g, "n2abclient")
    .replace(/polyfly/g, "n2ab")
    .replace(/--ptq-/g, "--n2ab-")
    .replace(/--pf-/g, "--n2-")
    .replace(/text-pf-/g, "text-n2-")
    .replace(/bg-pf-/g, "bg-n2-")
    .replace(/border-pf-/g, "border-n2-")
    .replace(/\bpf-/g, "n2-")
    // camelCase identifiers and @keyframes names: ptqShake -> n2abShake
    .replace(/ptq([A-Z])/g, "n2ab$1")
    .replace(/ptq-/g, "n2ab-")
    .replace(/\bptq\b/g, "n2ab")
    .split(HOST_TOKEN).join(KEEP_HOST);
}

/** Decode the array the way the runtime sees it (i.e. after rotation). */
function rotateToRuntime(arr) {
  const work = arr.slice();
  const at = (i) => decode(work[i - BASE]);
  for (let n = 0; n <= work.length; n++) {
    const sum =
      -parseInt(at(0x60b)) / 1 +
      (-parseInt(at(0x4ae)) / 2) * (-parseInt(at(0x1176)) / 3) +
      -parseInt(at(0xcd7)) / 4 +
      parseInt(at(0x53b)) / 5 +
      parseInt(at(0x8a2)) / 6 +
      (-parseInt(at(0x1d4)) / 7) * (-parseInt(at(0x5d0)) / 8) +
      parseInt(at(0x5f7)) / 9;
    if (sum === CHECKSUM) return { rotations: n, work };
    work.push(work.shift());
  }
  throw new Error("checksum never matched - bundle would hang at startup");
}

// ------------------------------------------------------------------ build

function build() {
  const original = fs.readFileSync(BUNDLE, "utf8");
  const { open, end, arr } = findStringArray(original);

  // 1. rebrand every string-table entry -----------------------------------
  let renamed = 0;
  const out = arr.map((enc, i) => {
    if (CHECKSUM_INDICES.includes(i)) return enc;
    const plain = decode(enc);
    const next = rebrandText(plain);
    if (next === plain) return enc;
    renamed++;
    return encode(next);
  });

  // 2. append the UI polish to the panel stylesheet ------------------------
  const css = fs.readFileSync(CSS_FILE, "utf8");
  const marker = "/* n2ab-ui-polish */";
  let cssIndex = -1;
  for (let i = 0; i < out.length; i++) {
    if (decode(out[i]).startsWith(":host{all:initial")) { cssIndex = i; break; }
  }
  if (cssIndex < 0) throw new Error("panel stylesheet not found");
  const baseCss = decode(out[cssIndex]).split(marker)[0];
  out[cssIndex] = encode(baseCss + marker + css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim());

  // 3. verify every rewritten entry still round-trips ----------------------
  for (let i = 0; i < out.length; i++) {
    if (typeof decode(out[i]) !== "string") throw new Error("decode failed at " + i);
  }

  // rebrand the raw code regions outside the array
  const literal = "[" + out.map((s) => "'" + s + "'").join(",") + "]";
  let src =
    rebrandText(original.slice(0, open)) + literal + rebrandText(original.slice(end + 1));

  // 4. register the extra modules -----------------------------------------
  // Strip a previous injection first so the build is idempotent.
  const OPEN = "/*<n2ab-modules>*/";
  const CLOSE = "/*</n2ab-modules>*/";
  const existing = src.indexOf(OPEN);
  if (existing !== -1) {
    const stop = src.indexOf(CLOSE, existing);
    if (stop === -1) throw new Error("unterminated previous module injection");
    src = src.slice(0, existing) + src.slice(stop + CLOSE.length);
  }

  const modules = fs.readFileSync(MODULES_FILE, "utf8");
  const bootAnchor = /(_0x420600\(\),)/;
  if (!bootAnchor.test(src)) throw new Error("module bootstrap anchor not found");
  src = src.replace(
    bootAnchor,
    "$1" + OPEN + "(function(__api){try{" + modules +
      "}catch(e){console.error('[n2ab] extra modules failed:',e)}})(_0x22424b)," + CLOSE
  );

  // 5. sanity checks -------------------------------------------------------
  const verify = findStringArray(src);
  const { rotations } = rotateToRuntime(verify.arr);
  new vm.Script(src, { filename: "n2ab_client.bundle.js" }); // throws on syntax error

  const leftovers = verify.arr
    .map(decode)
    .filter((s) => /polytraqqq(?!\.com)|polyfly|\bptq|__pf[A-Z]|\bpf-/i.test(s));

  return { src, renamed, rotations, leftovers, cssIndex };
}

const result = build();
console.log("strings rebranded : " + result.renamed);
console.log("checksum rotations: " + result.rotations + " (must be 348)");
console.log("brand leftovers   : " + result.leftovers.length);
console.log("stylesheet entry  : #" + result.cssIndex);

if (result.rotations !== 348) throw new Error("rotation changed - loader would break");
if (result.leftovers.length) throw new Error("brand leftovers: " + result.leftovers.slice(0, 5));

if (process.argv.includes("--check")) {
  console.log("\ncheck passed (nothing written)");
} else {
  fs.writeFileSync(BUNDLE, result.src);
  console.log("\nwrote " + path.relative(ROOT, BUNDLE));
}
