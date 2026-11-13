#!/bin/sh
# Rebuild the ARM interpreter and compiler bridge with Emscripten 3.1.69.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
vendor="$root/web/vendor"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

tar xzf "$vendor/source/unicorn.js-source.tar.gz" --strip-components=1 -C "$work"
tar xzf "$vendor/source/unicorn-source.tar.gz" --strip-components=1 -C "$work/unicorn"
# Upstream uses git apply for its TCI/Wasm adaptations.
git -C "$work/unicorn" init -q
git -C "$work/unicorn" apply "$vendor/source/unicorn-arm-temporaries.patch"
cp "$root/native/unicorn/tier.h" "$work/src/retrove-tier.h"
cp "$root/native/unicorn/budget.h" "$work/src/retrove-budget.h"
vp exec node --input-type=module - "$root/native/unicorn/exports.ts" "$work/src/retrove-exports.js" <<'JS'
import {readFile, writeFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const [source, target] = process.argv.slice(2);
await writeFile(target, stripTypeScriptTypes(await readFile(source, 'utf8')));
JS
cp "$vendor/source/unicorn-tci-tier.patch" "$work/src/patches/retrove-tier.patch"
git -C "$work" apply "$vendor/source/unicorn-js-tier.patch"
(cd "$work" && python3 build.py arm)

cat > "$work/adapter.mjs" <<'JS'
// ES module adapter for the bundled ARM-only Unicorn.js build.
const require = globalThis.process?.versions?.node ? (await import('node:module')).createRequire(import.meta.url) : undefined;
const __filename = new URL(import.meta.url).pathname;
const __dirname = new URL('.', import.meta.url).pathname;
JS
cat "$work/dist/unicorn_arm.js" >> "$work/adapter.mjs"
printf '\nexport default MUnicorn;\n' >> "$work/adapter.mjs"
cp "$work/adapter.mjs" "$vendor/unicorn-arm.mjs"
