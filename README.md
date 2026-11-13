# Retrove

A local app library and experimental runtime for preserved mobile software. iOS comes first, starting with BioShock; Android follows with Call of Duty: Black Ops Zombies. Gameplay compatibility is not yet established.

## Development

Use the installed Vite+ CLI with pnpm:

- `vp install` installs the pinned toolchain and test dependencies.
- `vp dev` starts the local app on port 8088.
- `vp check` checks formatting, lint and strict TypeScript.
- `vp test` runs storage, format, compatibility and ARM CPU tests.
- `vp build` creates the static browser build.

`src/` contains the maintained TypeScript implementation, organized into domain, library, storage and platform runtime modules. `web/` contains the imported runtime still being ported; it is not yet covered by strict TypeScript checks. The library, player, storage services and new compatibility modules use TypeScript. `tests/` retains the imported synthetic regression fixtures under Vite+. Generated upstream JS/WASM and licenses remain in `web/vendor/`.

The library keeps original archives locally; guest saves and settings have separate storage. Game executables and assets are never included in Git or deployment files. Browser storage can be removed by the browser or user; portable save backup and full lifecycle verification remain part of the implementation work.

The ARM libc helpers keep small memory copies and common string operations inside the emulator. Their assembly source and generated artifact live in `src/runtime/ios/libc/`. To regenerate the artifact with an installed LLVM toolchain, run `RETROVE_LLVM_BIN=/path/to/llvm/bin vp exec node src/build/compile-guest-libc.ts`, then `vp check` and `vp test`. The build tool rejects unresolved relocations and removes its temporary files.

See `NOTICE.md` for source provenance.
