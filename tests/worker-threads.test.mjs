import {afterEach, beforeAll, test, vi} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openIPA} from '../src/runtime/ios/package/ipa.ts';
import {runGuest} from '../web/runtime.mjs';
import {bundleNodeWorker, nodeExecutionPort} from '../src/runtime/cpu/worker/testing/node-port.ts';
import {configureWorkerThreads} from '../src/runtime/cpu/worker/worker-host.ts';

let bundle = '';
beforeAll(async () => {
  bundle = await bundleNodeWorker(new URL('../src/runtime/cpu/worker/execution-core.ts', import.meta.url), 'serveExecution');
}, 60_000);
afterEach(() => {
  vi.unstubAllGlobals();
  configureWorkerThreads({place: () => false});
});

async function runOnWorkers(fixture) {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('localStorage', {getItem: key => key === 'retrove.sharedMemory' || key === 'retrove.workerThreads' ? 'on' : null});
  const placed = [];
  configureWorkerThreads({place: thread => { placed.push(thread.id); return true; }, spawn: () => nodeExecutionPort(bundle)});
  const ipa = await openIPA(new Blob([await readFile(new URL('./fixtures/' + fixture, import.meta.url))]));
  let last;
  const result = await runGuest(ipa, {signal: AbortSignal.timeout(10_000), report: snapshot => { last = snapshot; }});
  return {result, placed, statistics: last?.workerThreads};
}

test('a thread on an execution worker sleeps, returns its value and is joined by the main thread', async () => {
  const {result, placed, statistics} = await runOnWorkers('threads.ipa');
  assert.deepEqual(result, {exitStatus: 0, calls: 3});
  assert.deepEqual(placed, [2]);
  assert.equal(statistics.threads, 1);
  assert.equal(statistics.hostCalls, 1);
}, 20_000);

test('a worker thread blocks in dispatch_once on a mutex its main thread holds, without blocking the main thread', async () => {
  const {result, placed, statistics} = await runOnWorkers('dispatch-contention.ipa');
  assert.equal(result.exitStatus, 0);
  assert.deepEqual(placed, [2]);
  assert.ok(statistics.hostCalls >= 1);
}, 20_000);
