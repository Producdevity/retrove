import {ExecutionBudget} from '../src/runtime/cpu/execution-budget.ts';
import {Gauge, gauges} from '../src/runtime/diagnostics/gauges.ts';
import createUnicorn from './vendor/unicorn-arm.mjs';
import {UnicornRegisters} from '../src/runtime/cpu/unicorn/registers.ts';
import {UnicornContexts} from '../src/runtime/cpu/unicorn/contexts.ts';
import {UnicornBudget} from '../src/runtime/cpu/unicorn/budget.ts';
import {TciTier, TciTierLimit} from '../src/runtime/cpu/tci/tier.ts';
import {TranslatedTier} from '../src/runtime/cpu/translation/tier.ts';
import {RegisterBridge} from '../src/runtime/cpu/translation/register-bridge.ts';
import {runTranslated} from '../src/runtime/cpu/translation/runner.ts';
import {translationCacheEnabled, translationEnabled} from '../src/runtime/cpu/translation/settings.ts';
import {ownCpuObject} from '../src/runtime/cpu/own/own-cpu-object.ts';
import {deviceBudget} from '../src/runtime/memory/device-budget.ts';
import {loadTranslationProfile, saveTranslationProfile} from '../src/runtime/cpu/translation/profile-storage.ts';

const PAGE = 4096;
const COPY_CHUNK = 1 << 20;
const EXECUTE = 4;

function uint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer`);
  }
  return value;
}

function range(address, size, aligned = false) {
  uint32(address, 'address');
  if (!Number.isSafeInteger(size) || size < 0 || address + size > 0x100000000) {
    throw new RangeError('Invalid guest address range');
  }
  if (aligned && (!size || address % PAGE || size % PAGE)) {
    throw new RangeError('Guest mappings require nonempty 4 KiB-aligned ranges');
  }
}

export async function createCPU({budget = ExecutionBudget.Instructions, compilationThreshold = TciTierLimit.Threshold, translation = translationEnabled() && deviceBudget().translation, translationProfile, cpu: kind = 'unicorn'} = {}) {
  if (!Object.values(ExecutionBudget).includes(budget)) throw new TypeError("Unknown CPU execution budget.");
  // The own CPU needs the translated tier's arena; without it Unicorn runs the guest.
  if (kind === 'own' && translation) {
    const key = translationCacheEnabled() ? translationProfile : undefined;
    return ownCpuObject(budget, {profile: key ? await loadTranslationProfile(key) : undefined, cache: key,
      codeBudget: deviceBudget().codeBytes, onProfile: key ? p => saveTranslationProfile(key, p) : undefined});
  }
  const profileKey = translation && translationCacheEnabled() ? translationProfile : undefined;
  const profile = profileKey ? await loadTranslationProfile(profileKey) : undefined;
  const uc = await createUnicorn();
  const compiler = compilationThreshold === 0 ? undefined : new TciTier(uc, compilationThreshold);
  const engine = new uc.Unicorn(uc.ARCH_ARM, uc.MODE_ARM);
  const handle = uc.getValue(engine.handle_ptr, '*');
  // Unicorn.js reads through getValue/setValue once per byte. Keep
  // one Wasm staging allocation and transfer textures, vertices and segments
  // with typed arrays while preserving Unicorn's normal memory checks.
  const transfer = uc._malloc(COPY_CHUNK);
  if (!transfer) { engine.close(); throw Error('Unable to allocate the guest memory transfer buffer'); }
  let registerTransfer;
  try { registerTransfer = new UnicornRegisters(uc, handle); }
  catch (error) { uc._free(transfer); engine.close(); throw error; }
  const registers = Array.from({ length: 16 }, (_, n) => uc[`ARM_REG_R${n}`]);
  // Translated functions share guest memory with Unicorn (uc_mem_map_ptr) and fall back to it for
  // everything they cannot run: host traps, unsupported instructions and unrepresentable state.
  const tier = translation ? new TranslatedTier(uc, {profile, cache: profileKey, codeBudget: deviceBudget().codeBytes,
    onProfile: profileKey ? p => saveTranslationProfile(profileKey, p) : undefined}) : undefined;
  const bridge = tier && new RegisterBridge(uc, handle, registerTransfer, {
    core: registers, doubles: Array.from({length: 32}, (_, n) => uc[`ARM_REG_D${n}`]), cpsr: uc.ARM_REG_CPSR,
    fpscr: uc.ARM_REG_FPSCR, pc: uc.ARM_REG_PC, threadPointer: uc.ARM_REG_C13_C0_3,
  }, () => tier.layout, () => tier.pages.view);
  const traps = [];
  const trapAt = pc => traps.find(t => pc >= t.first && pc <= t.last);
  if (tier) tier.excluded = pc => traps.some(t => pc >= t.first && pc <= t.last + 4);
  // Pages without execute permission hold no Unicorn blocks or translations, so host writes skip invalidation.
  const dataPages = tier ? new Uint8Array(1 << 20) : undefined;
  const markPages = (address, size, permissions) => dataPages?.fill(permissions & EXECUTE ? 0 : 1, address >>> 12, Math.ceil((address + size) / PAGE));
  const dataOnly = (address, size) => !!dataPages && size > 0 && dataPages.subarray(address >>> 12, Math.ceil((address + size) / PAGE)).every(flag => flag === 1);
  const leaveTranslated = () => bridge?.leave();
  const hooks = new Set();
  let blocks;
  try { blocks = budget === ExecutionBudget.Blocks ? new UnicornBudget(uc, handle) : undefined; }
  catch (error) {
    registerTransfer.close(); uc._free(transfer); compiler?.close(); engine.close(); throw error;
  }
  let pending = null;
  let closed = false;
  let mappedBytes = 0, mappedPeak = 0, executedMilliseconds = 0, interpretedMilliseconds = 0;
  let failedWasm = false;
  const states = new UnicornContexts({
    allocate: () => engine.context_alloc(),
    save: context => engine.context_save(context),
    restore: context => engine.context_restore(context),
    free: context => engine.context_free(context),
  });
  let memoryFault = null;
  const invalidMemory = uc.HOOK_MEM_READ_UNMAPPED | uc.HOOK_MEM_WRITE_UNMAPPED | uc.HOOK_MEM_FETCH_UNMAPPED
    | uc.HOOK_MEM_READ_PROT | uc.HOOK_MEM_WRITE_PROT | uc.HOOK_MEM_FETCH_PROT;
  const accessNames = new Map([
    [uc.MEM_READ_UNMAPPED, 'unmapped read'], [uc.MEM_WRITE_UNMAPPED, 'unmapped write'],
    [uc.MEM_FETCH_UNMAPPED, 'unmapped instruction fetch'], [uc.MEM_READ_PROT, 'protected read'],
    [uc.MEM_WRITE_PROT, 'protected write'], [uc.MEM_FETCH_PROT, 'protected instruction fetch'],
  ]);
  hooks.add(engine.hook_add(invalidMemory, (_, type, address, size) => {
    memoryFault = { faultAddress: Number(address), faultType: type, faultAccess: accessNames.get(type) || String(type), faultSize: size };
    return false;
  }));

  function register(n) {
    if (!Number.isInteger(n) || n < 0 || n > 15) throw new RangeError('Expected register r0–r15');
    return registers[n];
  }

  // CP10/CP11 provide scalar VFP and Advanced SIMD. Enable both before
  // switching the CPU from Unicorn's reset state to ARM user mode.
  const cpacr = registerTransfer.read(uc.ARM_REG_C1_C0_2);
  registerTransfer.write(uc.ARM_REG_C1_C0_2, cpacr | (0xf << 20));
  registerTransfer.write(uc.ARM_REG_FPEXC, 1 << 30);
  // Apple's ARMv7 runtime starts scalar floating point in RunFast mode.
  const fpscr = registerTransfer.read(uc.ARM_REG_FPSCR);
  registerTransfer.write(uc.ARM_REG_FPSCR, fpscr | (1 << 24) | (1 << 25));
  registerTransfer.write(uc.ARM_REG_CPSR, 0x10);

  // The arena and translator tables are reserved up front; only pages that were used take memory.
  gauges.read(Gauge.WasmMemoryBytes, () => uc.getTciMemory().buffer.byteLength - (tier ? tier.pages.region.bytes - mappedPeak : 0));
  gauges.read(Gauge.GuestMappedBytes, () => mappedBytes);
  gauges.read(Gauge.GuestMappedPeak, () => mappedPeak);
  gauges.read(Gauge.GuestCpuMs, () => executedMilliseconds);
  gauges.read(Gauge.TranslatedFunctions, () => tier?.statistics.translatedFunctions ?? 0);
  gauges.read(Gauge.CodeFlushes, () => tier?.statistics.flushes ?? 0);
  gauges.read(Gauge.AotPrepared, () => tier?.statistics.aotPrepared ?? 0);
  gauges.read(Gauge.AotChunks, () => tier?.statistics.aotChunks ?? 0);
  const cpu = {
    get budget() { return budget; },
    get compiler() { return compiler?.statistics; },
    get translation() { return tier?.statistics; },
    get mappedBytes() { return mappedBytes; },
    get executedMilliseconds() { return executedMilliseconds; },
    /** Part of executedMilliseconds spent in Unicorn rather than translated code. */
    get interpretedMilliseconds() { return interpretedMilliseconds; },
    // Darwin ARM code reads its thread pointer from TPIDRURO. Unicorn includes
    // this register when saving and restoring a cooperative thread context.
    set threadPointer(address) { registerTransfer.write(uc.ARM_REG_C13_C0_3, address); bridge?.setThreadPointer(address); },
    map(address, size, permissions = 7) {
      range(address, size, true);
      if (tier) {
        const status = uc.ccall('uc_mem_map_ptr', 'number', ['pointer', 'number', 'number', 'number', 'pointer'], [handle, BigInt(address), BigInt(size), permissions, tier.pages.map(address, size)]);
        if (status !== uc.ERR_OK) { tier.pages.unmap(address, size); throw Error('Guest mapping failed: ' + uc.strerror(status)); }
      } else engine.mem_map(address, size, permissions);
      markPages(address, size, permissions);
      mappedBytes += size;
      mappedPeak = Math.max(mappedPeak, mappedBytes);
    },
    unmap(address, size) {
      range(address, size, true);
      engine.mem_unmap(address, size);
      tier?.invalidate(address, size);
      tier?.pages.unmap(address, size);
      markPages(address, size, EXECUTE);
      mappedBytes -= size;
    },
    protect(address, size, permissions) {
      range(address, size, true);
      engine.mem_protect(address, size, permissions);
      markPages(address, size, permissions);
    },
    write(address, bytes) {
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
      range(address, bytes.length);
      if (dataOnly(address, bytes.length) && tier.pages.write(address, bytes)) return;
      for (let i = 0; i < bytes.length; i += COPY_CHUNK) {
        const chunk = bytes.subarray(i, i + COPY_CHUNK);
        uc.HEAPU8.set(chunk, transfer);
        const code = uc._uc_mem_write(handle, BigInt(address + i), transfer, BigInt(chunk.length));
        if (code !== uc.ERR_OK) throw Error('Guest memory write failed: ' + uc.strerror(code));
        const invalidation = uc._retrove_tci_invalidate(handle, address + i, chunk.length);
        if (invalidation !== uc.ERR_OK) throw Error('Guest code invalidation failed: ' + uc.strerror(invalidation));
        tier?.invalidate(address + i, chunk.length);
      }
    },
    read(address, length) {
      range(address, length);
      const bytes = new Uint8Array(length);
      if (tier?.pages.read(address, bytes)) return bytes;
      for (let i = 0; i < length; i += COPY_CHUNK) {
        const count = Math.min(COPY_CHUNK, length - i);
        const code = uc._uc_mem_read(handle, BigInt(address + i), transfer, BigInt(count));
        if (code !== uc.ERR_OK) throw Error('Guest memory read failed: ' + uc.strerror(code));
        bytes.set(uc.HEAPU8.subarray(transfer, transfer + count), i);
      }
      return bytes;
    },
    read32(address) {
      const host = tier && (address & 4095) <= 4092 ? tier.pages.host(address) : -1;
      if (host >= 0) return tier.pages.view.getUint32(host, true);
      const b = cpu.read(address, 4);
      return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
    },
    getReg(n) {
      if (bridge?.translated) { register(n); return bridge.get(n); }
      return registerTransfer.read(register(n)) >>> 0;
    },
    setReg(n, value) {
      if (bridge?.translated) { register(n); bridge.set(n, value); return; }
      registerTransfer.write(register(n), value >>> 0);
    },
    get cpsr() { return bridge ? bridge.cpsr : registerTransfer.read(uc.ARM_REG_CPSR) >>> 0; },
    set cpsr(value) { leaveTranslated(); registerTransfer.write(uc.ARM_REG_CPSR, value >>> 0); },
    get nextPC() { return bridge?.translated ? bridge.pc : (cpu.getReg(15) + ((cpu.cpsr >>> 5) & 1)) >>> 0; },
    // Preserve the low bit when returning from a host call (ARM/Thumb interworking).
    branch(target) {
      uint32(target, 'target');
      if (bridge?.translated) bridge.pc = target;
      else registerTransfer.write(uc.ARM_REG_PC, target);
    },
    trap(address, fn) {
      const pc = uint32(address, 'trap address') & ~1;
      return cpu.trapRange(pc >>> 0, pc >>> 0, fn);
    },
    trapRange(first, last, fn) {
      uint32(first, 'first trap address');
      uint32(last, 'last trap address');
      if (first > last || typeof fn !== 'function') throw new TypeError('Invalid trap range or callback');
      const record = {first, last, fn};
      traps.push(record);
      const hook = engine.hook_add(uc.HOOK_CODE, (_, address) => {
        pending = { address: Number(address), fn };
        engine.emu_stop();
      }, null, first, last);
      hooks.add(hook);
      blocks?.invalidateTraps();
      return () => {
        const at = traps.indexOf(record);
        if (at >= 0) traps.splice(at, 1);
        if (hooks.delete(hook)) { engine.hook_del(hook); blocks?.invalidateTraps(); }
      };
    },
    run(startPC = cpu.nextPC, { until = 0, count = 100000 } = {}) {
      uint32(startPC, 'start PC');
      uint32(until, 'stop address');
      if (!Number.isSafeInteger(count) || count <= 0 || count > 0x7fffffff) {
        throw new RangeError('A positive instruction budget is required');
      }
      pending = null;
      memoryFault = null;
      const before = performance.now();
      let pc = startPC;
      try {
        if (tier && tier.entry(pc) && bridge.enter()) {
          const result = runTranslated(tier, bridge, pc, until, count);
          if (result.reason !== 'fallback') return result;
          pc = result.pc;
          const trap = trapAt(pc & ~1);
          if (trap) { trap.fn(cpu, pc & ~1); return {reason: 'trap', address: pc & ~1, pc: cpu.nextPC}; }
        }
        if (tier) { tier.note(pc); bridge.leave(); }
        if (blocks?.requiresRefresh(until)) {
          // Unicorn flushes translated blocks when removing its instruction-count hook.
          // Stop before guest execution while installing that hook, then remove it below.
          blocks.stop();
          engine.emu_start(pc, until, 0, 1);
        }
        blocks?.start(count, until);
        const interpreted = performance.now();
        try { engine.emu_start(pc, until, 0, blocks ? 0 : count); }
        finally { interpretedMilliseconds += performance.now() - interpreted; }
      } catch (err) {
        const translated = !!bridge?.translated;
        failedWasm = err instanceof WebAssembly.RuntimeError && !translated;
        let faultPC;
        try { faultPC = cpu.getReg(15); } catch { /* Preserve the original failure if Wasm already aborted. */ }
        const address = memoryFault ? ` accessing 0x${memoryFault.faultAddress.toString(16)}` : '';
        const where = translated ? ' in translated code' : '';
        const error = new Error(`Guest CPU fault${faultPC === undefined ? '' : ' at 0x' + faultPC.toString(16)}${where}${address}: ${String(err)}`, {cause: err});
        throw Object.assign(error, { pc: faultPC }, memoryFault);
      } finally {
        executedMilliseconds += performance.now() - before;
      }
      if (pending) {
        const { fn, address } = pending;
        pending = null;
        fn(cpu, address);
        return { reason: 'trap', address, pc: cpu.nextPC };
      }
      return { reason: cpu.getReg(15) === until ? 'until' : 'budget', pc: cpu.nextPC };
    },
    saveState() {
      if (bridge?.translated) return {translated: bridge.save(), threadPointer: registerTransfer.read(uc.ARM_REG_C13_C0_3) >>> 0};
      return {unicorn: states.save()};
    },
    restoreState(saved) {
      if (saved.translated) {
        bridge.restore(saved.translated);
        cpu.threadPointer = saved.threadPointer;
        return;
      }
      if (bridge) bridge.translated = false;
      states.restore(saved.unicorn);
    },
    freeState(saved) { if (saved.unicorn) states.release(saved.unicorn); },
    close() {
      if (closed) return;
      closed = true;
      // A trap in the Wasm engine itself can leave its internal allocator invalid.
      // Dropping the instance then releases all memory without running guest cleanup.
      if (failedWasm) return;
      compiler?.close();
      states.close();
      blocks?.close();
      for (const hook of hooks) engine.hook_del(hook);
      hooks.clear();
      registerTransfer.close();
      uc._free(transfer);
      engine.close();
      tier?.close();
    },
  };
  return cpu;
}
