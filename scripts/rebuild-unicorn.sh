#!/bin/sh
# Rebuild the patched ARM interpreter from the pinned, bundled sources.
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
