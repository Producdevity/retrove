import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test,vi} from 'vite-plus/test';
import {openIPA} from '../web/ipa.mjs';
import {runGuest} from '../web/runtime.mjs';

async function fixture(name) {
  const bytes = await readFile(new URL('./fixtures/' + name + '.ipa', import.meta.url));
  return openIPA(new Blob([bytes]));
}

function trace() {
  const events = [], states = [];
  return {events, states, diagnostic: (level, area, message, details) => events.push({level, area, message, details}),
    report: state => states.push(state)};
}

test('loader errors include the last stage before a CPU is available', async () => {
  const session = trace();
  const ipa = {executablePath: 'Payload/Game.app/Game', readExecutable: () => new Uint8Array(8)};
  await assert.rejects(runGuest(ipa, session), /Mach-O/);
  const state = session.states.at(-1);
  assert.equal(state.phase, 'Parse ARM Mach-O');
  assert.deepEqual(state.registers, {});
  assert.match(state.fault.message, /Mach-O/);
  assert.equal(session.events.at(-1).level, 'error');
});

test('a host exception records the active GLES call, CPU registers and link summary', async () => {
  const ipa = await fixture('smoke'), session = trace();
  const error = new Error('render device lost');
  await assert.rejects(runGuest(ipa, {...session, graphics() { throw error; }}), e => e === error);
  const state = session.states.at(-1);
  assert.equal(state.fault.message, error.message);
  assert.match(state.phase, /Application entry at/);
  assert.deepEqual(state.activeImports, ['_glClearColor']);
  assert.equal(state.recentImports.length, 4);
  assert.equal(state.calls, 4);
  assert.equal(state.threadId, 1);
  for (const reg of ['r0', 'r12', 'pc', 'lr', 'sp', 'cpsr']) assert.match(state.registers[reg], /^0x[\da-f]+$/);
  assert.equal(state.imports, 5);
  assert.equal(state.fault.imageCode.lr.segment, '__TEXT');
  assert.match(state.fault.imageCode.lr.bytes, /^(?:[0-9a-f]{2} ){23}[0-9a-f]{2}$/);
  assert.equal(state.initializers, 1);
  assert.deepEqual(state.render, {clearCalls: 0, drawCalls: 0, presentAttempts: 0, presentedFrames: 0});
});

test('worker faults retain the worker registers and unresolved symbol across scheduler unwind', async () => {
  const ipa = await fixture('threads'), session = trace();
  const executable = await ipa.readExecutable();
  const pos = Buffer.from(executable).indexOf('_usleep\0');
  assert.ok(pos >= 0);
  executable.set(new TextEncoder().encode('_absent'), pos);
  await assert.rejects(runGuest({...ipa, readExecutable: () => executable}, session), /_absent/);
  const state = session.states.at(-1);
  assert.equal(state.threadId, 2);
  assert.equal(state.fault.symbol, '_absent');
  assert.equal(state.registers.pc, state.fault.address);
  assert.equal(state.registers.r0, '0x1f4');
  assert.equal(state.fault.access, 'unmapped instruction fetch');
  assert.deepEqual(state.unsupported, ['_absent']);
  assert.equal(state.unsupportedCount, 1);
});

test('a successful direct framebuffer clear records graphics activity without claiming an EAGL presentation', async () => {
  const ipa = await fixture('smoke'), session = trace();
  const gl = {isContextLost: () => false, clearColor() {}, clear() {}};
  await runGuest(ipa, {...session, graphics: () => gl});
  const state = session.states.at(-1);
  assert.equal(state.phase, 'Guest exited');
  assert.equal(state.exitStatus, 0);
  assert.equal(state.calls, 5);
  assert.ok(state.cpuSlices >= 5);
  assert.equal(state.render.clearCalls, 1);
  assert.equal(state.render.presentedFrames, 0);
  assert.ok(session.events.some(e => e.area === 'graphics' && /First successful/.test(e.message)));
});

test('live heartbeat reports a CPU-only loop with no host calls and stopping it preserves the registers', async t => {
  const ipa = await fixture('smoke'), session = trace(), controller = new AbortController();
  const executable = await ipa.readExecutable();
  // Replace the fixture entry instruction with ARM "b .", keeping its initializer and real Mach-O loader.
  executable.set([0xfe, 0xff, 0xff, 0xea], 0x800);
  vi.useFakeTimers({toFake: ['setInterval']});
  t.onTestFinished(() => vi.useRealTimers());
  let heartbeat;
  const traceEvent = session.diagnostic;
  session.diagnostic = (...event) => {
    traceEvent(...event);
    if (event[2].startsWith('Application entry at')) {
      setImmediate(() => {
        vi.advanceTimersByTime(5000);
        heartbeat = session.states.at(-1);
        controller.abort();
      });
    }
  };
  await assert.rejects(runGuest({...ipa, readExecutable: () => executable}, {...session, signal: controller.signal}), /abort/i);
  assert.match(heartbeat.phase, /Application entry/);
  assert.equal(heartbeat.calls, 0);
  assert.ok(heartbeat.budgetSlices > 0);
  assert.equal(heartbeat.registers.pc, '0x8800');
  assert.equal(session.states.at(-1).registers.pc, '0x8800');
  assert.match(session.states.at(-1).fault.imageCode.pc.bytes, /fe ff ff ea/);
  assert.equal(session.events.at(-1).message, 'Guest stopped');
});
