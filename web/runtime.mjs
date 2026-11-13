import {compressionImports} from './compression.mjs';
import {guestStack} from './backtrace.mjs';
import {nonlocalJumps} from './nonlocal-jump.mjs';
import {coreGraphics} from './coregraphics.mjs';
import {commonCrypto} from './commoncrypto.mjs';
import {createCPU} from './cpu.mjs';
import {prepareBioShockConfig} from './bioshock-config.mjs';
import {parseMachO, loadMachO, prepareStartup} from './macho.mjs';
import {Heap, read32, write32} from './memory.mjs';
import {systemImports} from './libsystem.mjs';
import {glesImports} from './gles.mjs';
import {audioQueues} from './audio-queue.mjs';
import {audioFiles} from './audio-file.mjs';
import {audioImports} from './audio.mjs';
import {systemSounds} from './system-sound.mjs';
import {cxxImports} from './cxx.mjs';
import {GuestLandingPad} from './sjlj.mjs';
import {threadImports} from './threads.mjs';
import {dispatchImports} from './dispatch.mjs';
import {objcImports} from './objc.mjs';

const GATES = 0x40000000, GATE_BYTES = 0x40000;
const RETURN = GATES + GATE_BYTES - 4;
const STACK_TOP = 0x70000000, STACK_SIZE = 4 << 20;
const hex = address => '0x' + address.toString(16);
const label = value => String(value).slice(0, 192);
const registerNames = Array.from({length: 13}, (_, i) => 'r' + i).concat('sp', 'lr', 'pc');
const sleep = () => new Promise(resolve => setTimeout(resolve, 0));

export async function runGuest(ipa, {audioContext = () => null, graphics = () => { throw Error('WebGL unavailable'); },
  log = () => {}, report = () => {}, diagnostic = (_level, _area, message) => log(message), mediaHost, signal} = {}) {
  const started = performance.now();
  let cpu, heap, threads, audio, queues, sounds, objc, closeFiles, image;
  let phase = 'Read executable', calls = 0, cpuSlices = 0, budgetSlices = 0, pending = 0, firstFault;
  let completedInitializers = 0;
  let link = {}, exitStatus, firstRender = false;
  const render = {clearCalls: 0, drawCalls: 0, presentAttempts: 0, presentedFrames: 0};
  const recent = [], active = [], deferred = new Map();
  const missingAssets = [], missingAssetSet = new Set(), recentMissingAssets = [];
  let missingAssetRequests = 0;

  function snapshot(full = false) {
    const registers = {};
    if (cpu) {
      // A failed Wasm engine can also reject register reads. Keep the rest of the report.
      try {
        for (let i = full ? 0 : 13; i <= 15; i++) registers[registerNames[i]] = hex(cpu.getReg(i));
        registers.cpsr = hex(cpu.cpsr);
      } catch { /* The last successful CPU reads are still useful. */ }
    }
    // Put fault context before variable-length lists so it survives a shortened mobile export.
    return {phase, elapsedMs: Math.round(performance.now() - started), calls, cpuSlices, budgetSlices, completedInitializers,
      threadId: threads?.funcs._pthread_self(), registers, activeImports: active.filter(call=>call.thread===threads?.funcs._pthread_self()).slice(-6).map(call=>call.name),
      lastSelector: objc?.lastSelector, render: {...render}, heapAllocations: heap?.live.size, exitStatus,
      recentImports: recent.slice(), missingAssetRequests, missingAssets: missingAssets.slice(), recentMissingAssets: recentMissingAssets.slice(), ...link};
  }
  function milestone(message, details) {
    phase = message;
    report(snapshot());
    diagnostic('info', 'guest', message, details);
  }
  function missingAsset(path) {
    missingAssetRequests++;
    const name = label(path);
    const previous=recentMissingAssets.indexOf(name);
    if(previous!==-1)recentMissingAssets.splice(previous,1);
    recentMissingAssets.push(name);
    if(recentMissingAssets.length>10)recentMissingAssets.shift();
    if (missingAssets.length >= 10 || missingAssetSet.has(name)) return;
    missingAssetSet.add(name);
    missingAssets.push(name);
  }
  function onRender() {
    if (firstRender) return;
    firstRender = true;
    report(snapshot());
    diagnostic('info', 'graphics', 'First successful guest rendering call', {...render});
  }
  function captureFault(error) {
    if (firstFault || error instanceof GuestExit || error instanceof GuestLandingPad) return;
    const fault = {name: label(error?.name || 'Error'), message: String(error?.message || error).slice(0, 1024)};
    if (error?.faultAddress !== undefined) {
      fault.address = hex(error.faultAddress);
      fault.access = error.faultAccess;
      fault.size = error.faultSize;
      for (const [name, base] of deferred) {
        if (error.faultAddress >= base && error.faultAddress < base + 4096) { fault.symbol = label(name); break; }
      }
    }
    const state = snapshot(true);
    if(cpu&&image)try{
      fault.guestStack=guestStack(cpu,24,image).map(address=>({address:hex(address),symbol:image.symbolAt(address-address%2)}));
    }catch { /* Preserve the primary fault when the CPU can no longer be inspected. */ }
    // Use the original Mach-O slice. It remains readable even after a Wasm trap.
    // Capture only short instruction windows that fall in executable segments.
    if (image) {
      const code = {};
      for (const register of ['pc', 'lr']) {
        const address = Number(state.registers[register]);
        const pc = address - address % 2;
        const segment = image.segments.find(s => (s.protection & 4) && pc >= s.address && pc < s.address + s.fileSize);
        if (!segment) continue;
        const section = segment.sections.find(s => pc >= s.address && pc < s.address + s.size);
        const start = Math.max(section?.address ?? segment.address, pc - 8);
        const end = Math.min(section ? section.address + section.size : segment.address + segment.fileSize, pc + 16);
        const offset = segment.fileOffset + start - segment.address;
        code[register] = {segment: segment.name, section: section?.name, symbol: image.symbolAt(pc), start: hex(start),
          bytes: Array.from(image.bytes.subarray(offset, offset + end - start), v => v.toString(16).padStart(2, '0')).join(' ')};
      }
      if (Object.keys(code).length) fault.imageCode = code;
    }
    firstFault = {fault, ...state};
    report(firstFault);
  }

  // Also samples asynchronous host waits, when no CPU slice is completing.
  const heartbeat = setInterval(() => { if (!firstFault) report(snapshot()); }, 5000);
  try {
    milestone('Read executable', {path: label(ipa.executablePath)});
    signal?.throwIfAborted();
    const bytes = await ipa.readExecutable();
    signal?.throwIfAborted();
    milestone('Parse ARM Mach-O', {executableBytes: bytes.length});
    image = parseMachO(bytes);
    const unique = new Set(image.imports.filter(b => b.mode !== 'weak').map(b => b.name));
    link = {entry: image.entry, imports: unique.size, executableBytes: bytes.length,
      segmentCount: image.segments.length, dylibCount: image.dylibs.length};
    milestone('Initialize ARM WebAssembly CPU', {entry: hex(image.entry), imports: unique.size});
    cpu = await createCPU();
    signal?.throwIfAborted();
    milestone('Map segments and bind imports');
    const memory = {map: cpu.map, write: cpu.write, read32: p => read32(cpu,p), write32: (p,v) => write32(cpu,p,v)};
    heap = new Heap(cpu);
    const gates = new Map(), stubs = new Map();
    threads = threadImports(cpu, heap, RETURN);
    const jumps=nonlocalJumps(cpu,heap,threads);
    threads.nativeFunctions.set('_setjmp',jumps.save);
    const sys = systemImports(cpu, heap, ipa, log, threads.funcs._pthread_self, diagnostic, missingAsset, hostGate, nested, image);
    const cxx = cxxImports(cpu, heap, threads.funcs._pthread_self, {threads, nested, hostGate, objc:() => objc});
    closeFiles = sys.closeFiles;
    queues = audioQueues(cpu,heap,nested,audioContext);
    audio = audioImports(cpu, heap, nested, audioContext);
    objc = objcImports(cpu, heap, ipa, graphics, nested, signal, service, {
      threads, sys, audio, mediaHost, diagnostic, hostGate, cxx,
      onLifecycle: milestone,
      onPresent(presented) {
        render.presentAttempts++;
        if (presented && ++render.presentedFrames === 1) {
          report(snapshot());
          diagnostic('info', 'graphics', 'First EAGL frame presented');
        }
      }
    });
    const cg=coreGraphics(cpu,heap,objc);
    objc.attachCoreGraphics(cg);
    sounds = systemSounds(cpu, ipa, audioContext, objc.fileURLPath, nested);
    const dispatch = dispatchImports(cpu, heap, threads, nested, objc, hostGate);
    objc.setDispatch(dispatch);
    const funcs = Object.assign(Object.create(null), sys.funcs, cxx.funcs, objc.funcs, threads.funcs,
      dispatch.funcs, cg.funcs, audio.funcs, queues.funcs, sounds.funcs, audioFiles(cpu,heap,nested), commonCrypto(cpu, heap), compressionImports(cpu, heap, signal), glesImports(cpu,heap,graphics,diagnostic));
    funcs._longjmp=jumps.longjmp;
    funcs.dyld_stub_binder=()=>{
      const sp=cpu.getReg(13),offset=read32(cpu,sp+4),binding=load.lazyTargets.get(offset);
      if(!binding?.target)throw Error('No dyld lazy binding at stream offset '+hex(offset));
      write32(cpu,binding.slot,binding.value);cpu.setReg(13,sp+8);cpu.setReg(12,binding.target);
      return {jump:binding.target};
    };
    function hostGate(b, fn) {
      const key = (b.library || '') + '\0' + b.name;
      if (gates.has(key)) return gates.get(key);
      const at = GATES + gates.size * 4;
      if (at >= RETURN) throw Error('Too many imported functions');
      gates.set(key, at);
      stubs.set(at, {fn, binding: b});
      return at;
    }
    cpu.map(GATES, GATE_BYTES, 5);
    // UDF terminates each translated block even when its host hook is missed.
    const gateCode = new Uint8Array(GATE_BYTES);
    const gateView = new DataView(gateCode.buffer);
    for (let i = 0; i < gateCode.length; i += 4) gateView.setUint32(i, 0xe7f000f0, true);
    cpu.write(GATES, gateCode);
    cpu.map(STACK_TOP - STACK_SIZE, STACK_SIZE, 3);
    cpu.trapRange(GATES, RETURN - 1, (_, at) => { pending = at; });
    const load = loadMachO(image, memory, b => {
      const data = threads.nativeFunctions?.get(b.name) ?? sys.data.get(b.name) ?? cxx.data.get(b.name)
        ?? objc.resolveData(b.name) ?? dispatch.data.get(b.name) ?? cg.data.get(b.name);
      if (data != null) return data;
      const fn = funcs[b.name];
      if (!fn && b.weak) return null;
      // Lazy slots are callable. Unknown eager symbols may instead be data. Give
      // each a unique unmapped page so a dereference faults at the first use.
      if (!fn && b.mode !== 'lazy') {
        if (!deferred.has(b.name)) {
          if (deferred.size >= 65536) throw Error('Too many unresolved eager imports');
          deferred.set(b.name, 0x80000000 + deferred.size * 4096);
        }
        return deferred.get(b.name);
      }
      return hostGate(b, fn);
    });
    const startup = prepareStartup(memory, STACK_TOP, '/' + ipa.executablePath);
    const baseSP = startup.rawStack - 32;
    const unsupported = [...new Set([...stubs.values()].filter(s => !s.fn).map(s => s.binding.name).concat([...deferred.keys()]))].sort();
    link = {...link, initializers: load.initializers.length, unsupportedCount: unsupported.length,
      unsupported: unsupported.slice(0, 40).map(label)};
    if (unsupported.length) diagnostic('debug', 'linker', 'Unresolved imports in this executable',
      unsupported.map(label).join('\n'));
    await prepareBioShockConfig(ipa, diagnostic);
    signal?.throwIfAborted();
    milestone('Install Objective-C metadata', {initializers: load.initializers.length, unresolvedImports: unsupported.length});
    objc.install(image);
    let lastYield = performance.now(), lastService = lastYield;
    async function nested(entry, args, wide = false) {
      const state = cpu.saveState();
      const stack = Math.floor((cpu.getReg(13) - Math.max(32, args.length * 4)) / 16) * 16;
      if (stack < threads.stackBottom) { cpu.freeState(state); throw Error('Guest stack exhausted'); }
      try { const lo=await call(entry, args, false, stack);return wide ? (BigInt(cpu.getReg(1))<<32n)|BigInt(lo) : lo; }
      finally { cpu.restoreState(state); cpu.freeState(state); }
    }
    async function call(entry, args, raw = false, sp = baseSP) {
      cpu.setReg(13, raw ? startup.rawStack : sp);
      cpu.setReg(14, RETURN);
      for (let i = 0; i < args.length; i++) {
        if (i < 4) cpu.setReg(i, args[i]);
        else write32(cpu, sp + (i - 4) * 4, args[i]);
      }
      let pc = entry;
      for (;;) {
        signal?.throwIfAborted();
        try {
          const result = await step(pc);
          if (result.unwind) throw result.unwind;
          if (result.done) return result.value;
          pc = result.pc;
          if (result.wait) {
            for (;;) {
              signal?.throwIfAborted();
              const value = result.wait();
              if (value !== undefined) { cpu.setReg(0,value); break; }
              // The blocked caller has yielded its CPU to runnable threads.
              await service(8);
              await sleep();
            }
          }
          if (result.budget || performance.now() - lastService > 4) await service();
          if (performance.now() - lastYield > 16) { await sleep(); lastYield = performance.now(); }
        } catch (error) {
          // A C++ throw can cross a guest callback invoked from a host import.
          // Pass the transfer back through nested() until its owning stack is
          // active, then restore the registers recorded by the guest compiler.
          if (!(error instanceof GuestLandingPad) || error.thread !== threads.funcs._pthread_self() ||
              error.sp > (raw ? startup.rawStack : sp)) throw error;
          pc = error.restore(cpu);
        }
      }
    }

    async function service(workerBudgetMs = 0, mainRunLoopTurn = false) {
      lastService = performance.now();
      await threads.advance(step, nested, workerBudgetMs);
      await audio?.pump();
      if (mainRunLoopTurn && threads.funcs._pthread_main_np()) {
        await dispatch.pollMain();
        await objc.pumpMovies();
        await audio.pumpSession(objc);
        await sounds.pump();
        await queues.pump();
      }
    }

    async function step(pc) {
      // Capture before nested guest callbacks and cooperative threads restore their caller's registers.
      try { return await executeStep(pc); }
      catch (error) { captureFault(error); throw error; }
    }

    async function executeStep(pc) {
      cpuSlices++;
      const result = cpu.run(pc, {until: RETURN, count: 65536});
      if (result.reason === 'until') return {done:true, value:cpu.getReg(0)};
      if (result.reason === 'budget') { budgetSlices++; return {pc:result.pc, budget:true}; }
      const host = stubs.get(pending);
      if (!host) throw Error('Invalid import gate ' + hex(pending));
      const lr = cpu.getReg(14);
      const lastSymbol = label(host.binding.name);
      const thread=threads.funcs._pthread_self();
      const record = lastSymbol + ' ← ' + hex(lr) + ' (thread ' + thread + ')';
      if (recent.at(-1) !== record) {
        recent.push(record);
        if (recent.length > 12) recent.shift();
      }
      if (!host.fn) throw Error('Missing import ' + lastSymbol + ' from ' + (host.binding.library || 'flat namespace') + ' (guest LR ' + hex(lr) + ')');
      calls++;
      const arg = n => n < 4 ? cpu.getReg(n) : read32(cpu, cpu.getReg(13) + (n - 4) * 4);
      active.push({name:lastSymbol,thread});
      let value;
      try {
        value = await host.fn(arg);
      } catch (error) {
        if (error instanceof GuestLandingPad) value = error;
        else { captureFault(error); throw error; }
      } finally { active.pop(); }
      if (lastSymbol === '_glClear') { render.clearCalls++; onRender(); }
      else if (lastSymbol === '_glDrawArrays' || lastSymbol === '_glDrawElements') { render.drawCalls++; onRender(); }
      if (value && typeof value === 'object') {
        if (value instanceof GuestLandingPad) return {pc:value.pc, unwind:value};
        if ('exit' in value) throw new GuestExit(value.exit);
        if ('threadExit' in value) return {done:true, value:value.threadExit};
        if ('wait' in value) return {pc:lr, wait:value.wait};
        if ('jump' in value) return {pc:value.jump};
        throw Error('Invalid host call result');
      }
      if (typeof value === 'bigint') {
        cpu.setReg(0, Number(value & 0xffffffffn));
        cpu.setReg(1, Number((value >> 32n) & 0xffffffffn));
      } else if (value !== undefined) cpu.setReg(0, value);
      return {pc:lr};
    }

    try {
      cpu.setReg(13, baseSP);
      milestone('Objective-C +load');
      await objc.start?.();
      for (const [i, pc] of load.initializers.entries()) {
        phase = 'initializer ' + (i + 1) + '/' + load.initializers.length + ' at ' + hex(pc);
        if (i % 128 === 0) milestone(phase);
        await call(pc, startup.args);
        completedInitializers++;
      }
      milestone('Application entry at ' + hex(load.entry));
      exitStatus = (await call(load.entry, load.entryKind === 'thread' ? [] : startup.args, load.entryKind === 'thread')) | 0;
    } catch (e) {
      if (!(e instanceof GuestExit)) throw e;
      exitStatus = e.status;
    }
    milestone('Run exit handlers', {exitStatus});
    while (sys.finalizers.length) {
      const fn = sys.finalizers.pop();
      await call(fn.pc, [fn.arg]);
    }
    phase = 'Guest exited';
    report(snapshot(true));
    diagnostic(exitStatus === 0 ? 'info' : 'error', 'guest', 'Guest exited with status ' + exitStatus, {exitStatus, calls});
    return {exitStatus, calls};
  } catch (error) {
    captureFault(error);
    const state = firstFault;
    if (state) {
      const message = signal?.aborted ? 'Guest stopped' : state.fault.message;
      diagnostic(signal?.aborted ? 'info' : 'error', 'guest', message, {phase: state.phase,
        pc: state.registers.pc, lr: state.registers.lr, threadId: state.threadId, fault: state.fault});
      if (state.fault.symbol) throw new Error(message + ' [' + state.fault.symbol + ']', {cause: error});
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    try { objc?.close?.(); sounds?.close(); queues?.close(); audio?.close(); await closeFiles?.(); }
    finally { try { threads?.close(); } finally { cpu?.close(); } }
  }
}

class GuestExit extends Error {
  constructor(status) { super('guest exit'); this.status = status; }
}
