import {BlockBudget, ExecutionBudget} from '../src/runtime/cpu/execution-budget.ts';
import createUnicorn from './vendor/unicorn-arm.mjs';
import {UnicornRegisters} from '../src/runtime/cpu/unicorn/registers.ts';
import {UnicornContexts} from '../src/runtime/cpu/unicorn/contexts.ts';

const PAGE = 4096;
const COPY_CHUNK = 1 << 20;

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

export async function createCPU({budget = ExecutionBudget.Instructions} = {}) {
  if (!Object.values(ExecutionBudget).includes(budget)) throw new TypeError("Unknown CPU execution budget.");
  const uc = await createUnicorn();
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
  const hooks = new Set();
  const blocks = budget === ExecutionBudget.Blocks ? new BlockBudget() : undefined;
  if (blocks) hooks.add(engine.hook_add(uc.HOOK_BLOCK, (_, _address, bytes) => {
    if (!blocks.enter(bytes)) engine.emu_stop();
  }, null, 1, 0));
  let pending = null;
  let closed = false;
  let mappedBytes = 0, executedMilliseconds = 0;
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

  const cpu = {
    get budget() { return budget; },
    get mappedBytes() { return mappedBytes; },
    get executedMilliseconds() { return executedMilliseconds; },
    // Darwin ARM code reads its thread pointer from TPIDRURO. Unicorn includes
    // this register when saving and restoring a cooperative thread context.
    set threadPointer(address) { registerTransfer.write(uc.ARM_REG_C13_C0_3, address); },
    map(address, size, permissions = 7) {
      range(address, size, true);
      engine.mem_map(address, size, permissions);
      mappedBytes += size;
    },
    unmap(address, size) {
      range(address, size, true);
      engine.mem_unmap(address, size);
      mappedBytes -= size;
    },
    protect(address, size, permissions) {
      range(address, size, true);
      engine.mem_protect(address, size, permissions);
    },
    write(address, bytes) {
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
      range(address, bytes.length);
      for (let i = 0; i < bytes.length; i += COPY_CHUNK) {
        const chunk = bytes.subarray(i, i + COPY_CHUNK);
        uc.HEAPU8.set(chunk, transfer);
        const code = uc._uc_mem_write(handle, BigInt(address + i), transfer, BigInt(chunk.length));
        if (code !== uc.ERR_OK) throw Error('Guest memory write failed: ' + uc.strerror(code));
      }
    },
    read(address, length) {
      range(address, length);
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += COPY_CHUNK) {
        const count = Math.min(COPY_CHUNK, length - i);
        const code = uc._uc_mem_read(handle, BigInt(address + i), transfer, BigInt(count));
        if (code !== uc.ERR_OK) throw Error('Guest memory read failed: ' + uc.strerror(code));
        bytes.set(uc.HEAPU8.subarray(transfer, transfer + count), i);
      }
      return bytes;
    },
    getReg(n) { return registerTransfer.read(register(n)) >>> 0; },
    setReg(n, value) { registerTransfer.write(register(n), value >>> 0); },
    get cpsr() { return registerTransfer.read(uc.ARM_REG_CPSR) >>> 0; },
    set cpsr(value) { registerTransfer.write(uc.ARM_REG_CPSR, value >>> 0); },
    get nextPC() { return (cpu.getReg(15) + ((cpu.cpsr >>> 5) & 1)) >>> 0; },
    // Preserve the low bit when returning from a host call (ARM/Thumb interworking).
    branch(target) { registerTransfer.write(uc.ARM_REG_PC, uint32(target, 'target')); },
    trap(address, fn) {
      const pc = uint32(address, 'trap address') & ~1;
      return cpu.trapRange(pc >>> 0, pc >>> 0, fn);
    },
    trapRange(first, last, fn) {
      uint32(first, 'first trap address');
      uint32(last, 'last trap address');
      if (first > last || typeof fn !== 'function') throw new TypeError('Invalid trap range or callback');
      const hook = engine.hook_add(uc.HOOK_CODE, (_, address) => {
        pending = { address: Number(address), fn };
        engine.emu_stop();
      }, null, first, last);
      hooks.add(hook);
      blocks?.invalidateTraps();
      return () => {
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
      try {
        if (blocks?.requiresRefresh(until)) {
          // Unicorn flushes translated blocks when removing its instruction-count hook.
          // Stop before guest execution while installing that hook, then remove it below.
          blocks.stop();
          engine.emu_start(startPC, until, 0, 1);
        }
        blocks?.start(count, until);
        engine.emu_start(startPC, until, 0, blocks ? 0 : count);
      } catch (err) {
        failedWasm = err instanceof WebAssembly.RuntimeError;
        let pc;
        try { pc = cpu.getReg(15); } catch { /* Preserve the original failure if Wasm already aborted. */ }
        const address = memoryFault ? ` accessing 0x${memoryFault.faultAddress.toString(16)}` : '';
        const error = new Error(`Guest CPU fault${pc === undefined ? '' : ' at 0x' + pc.toString(16)}${address}: ${String(err)}`, {cause: err});
        throw Object.assign(error, { pc }, memoryFault);
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
    saveState() { return states.save(); },
    restoreState(state) { states.restore(state); },
    freeState(state) { states.release(state); },
    close() {
      if (closed) return;
      closed = true;
      // A trap in the Wasm engine itself can leave its internal allocator invalid.
      // Dropping the instance then releases all memory without running guest cleanup.
      if (failedWasm) return;
      states.close();
      for (const hook of hooks) engine.hook_del(hook);
      hooks.clear();
      registerTransfer.close();
      uc._free(transfer);
      engine.close();
    },
  };
  return cpu;
}
