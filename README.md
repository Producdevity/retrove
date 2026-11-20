# Retrove

A local app library and experimental runtime for preserved mobile software, running in the browser. iOS comes first, starting with BioShock; Android follows with Call of Duty: Black Ops Zombies. BioShock reaches gameplay, but does not yet hold a playable frame rate on phones.

![BioShock's opening scene running in Retrove in Safari](docs/bioshock.jpg)

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

The CPU translates guest ARM functions into WebAssembly modules in a worker. The bundled Unicorn interpreter runs code the translator does not support, and everything when translation is off. The translated-code budget is bounded.

To rebuild the generated CPU module, activate Emscripten 3.1.69 and run `sh scripts/rebuild-unicorn.sh`. The script uses the bundled sources, applies the maintained patches and native bridge, and removes its temporary build directory. Run `vp check`, `vp test` and `vp build` afterward.

See `NOTICE.md` for source provenance.

## Runtime direction

Retrove targets a shared ARM32 execution core with separate iOS and Android platform support. The CPU boundary owns registers, instruction execution, memory permissions, interrupts and code invalidation. Platform layers own executable loading and operating-system APIs. Graphics, audio, input and persistent storage are host services. Game-specific compatibility stays outside the CPU core.

BioShock is the first acceptance workload. Its Linux port is a reference for individual compatibility issues, not Retrove's runtime foundation. Supporting another operating system requires its API and ABI implementation; CPU support alone does not make arbitrary IPAs or APKs compatible.

The next CPU candidate reuses [Dynarmic's ARM frontend](https://github.com/touchHLE/dynarmic) with a new Wasm backend, including SIMD and block dispatch inside Wasm. It remains an isolated experiment. The shipped backend described above has not been replaced. Integration requires broader instruction and floating-point correctness, memory and code invalidation tests, bounded cache behavior, and measured gameplay on modern phones.

Keep the library shell independent of execution modules, load platform support when needed, and bound translation and asset caches. A full guest operating-system image is outside this architecture. The acceptance target remains sustained interactive gameplay at 30 FPS, with save and relaunch verification.

## License

Retrove is licensed under the GNU General Public License, version 2 or (at your option) any later version. See `LICENSE`. It includes Unicorn, which is GPLv2; third-party licenses are kept in `web/vendor/`.
