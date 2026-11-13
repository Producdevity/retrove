# Retrove

A local app library and experimental runtime for preserved mobile software. iOS comes first, starting with BioShock; Android follows with Call of Duty: Black Ops Zombies. Gameplay compatibility is not yet established.

## Development

Use the installed Vite+ CLI with pnpm:

- `vp install` installs the pinned toolchain and test dependencies.
- `vp dev` starts the local app on port 8088.
- `vp check` checks formatting, lint and strict TypeScript.
- `vp test` runs storage, format, compatibility and ARM CPU tests.
- `vp build` creates the static browser build.

`src/` contains the maintained TypeScript implementation, organized into domain, library, storage and platform runtime modules. `web/` and `app/` contain the imported runtime and initial UI being ported; they are not yet covered by strict TypeScript checks. `tests/` retains the imported synthetic regression fixtures under Vite+. Generated upstream JS/WASM and licenses remain in `web/vendor/`.

The library keeps original archives locally; guest saves and settings have separate storage. Game executables and assets are never included in Git or deployment files. Browser storage can be removed by the browser or user; portable save backup and full lifecycle verification remain part of the implementation work.

See `NOTICE.md` for source provenance.
