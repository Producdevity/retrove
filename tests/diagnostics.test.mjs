import {test} from 'vite-plus/test';
import assert from 'node:assert/strict';
import {DiagnosticRecorder} from '../src/runtime/diagnostics/diagnostics.ts';

class MemoryStorage {
  data = new Map();
  writes = 0;
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, data) { this.writes++; this.data.set(key, data); }
  removeItem(key) { this.data.delete(key); }
}

test('recovery shows the last durable checkpoint and keeps it through a retry', () => {
  const storage = new MemoryStorage();
  storage.setItem('unrelated', 'keep');
  const first = new DiagnosticRecorder({storage});
  first.start('original.ipa', {bytes: 1628682780});
  first.event('info', 'IPA', 'Reading executable');
  first.snapshot({pc: '0x1000', phase: 'link'});
  first.flush();
  first.event('debug', 'guest', 'Uncheckpointed event');

  const reopened = new DiagnosticRecorder({storage});
  assert.equal(reopened.current.state, 'interrupted');
  assert.match(reopened.text(), /no recorded exit/);
  assert.match(reopened.text(), /Reading executable/);
  assert.match(reopened.text(), /0x1000/);
  assert.doesNotMatch(reopened.text(), /Uncheckpointed/);
  reopened.start('self-test');
  assert.equal(reopened.previous.id, first.current.id);
  reopened.finish('completed', 'Fixture passed');
  assert.match(reopened.text('previous'), /original\.ipa/);
  assert.match(reopened.text(), /Fixture passed/);
  const again = new DiagnosticRecorder({storage});
  assert.equal(again.current.state, 'completed');
  assert.equal(again.previous.state, 'interrupted');
  again.start('third.ipa');
  again.finish('stopped');
  assert.equal(storage.length, 3); // unrelated item and two retained attempts
  assert.equal(storage.getItem('unrelated'), 'keep');
  assert.equal(again.previous.label, 'self-test');
});

test('a noisy run keeps startup, the first failure, and the newest checkpoint', () => {
  const storage = new MemoryStorage();
  const log = new DiagnosticRecorder({storage});
  log.start('stress');
  log.event('info', 'loader', 'First checkpoint');
  for (let i = 1; i < 500; i++) log.event('debug', 'guest', 'before ' + i);
  log.event('error', 'guest', 'Original failure', Error('Missing symbol'));
  for (let i = 1; i <= 500; i++) log.event('debug', 'guest', 'tail ' + i, {detail: 'x'.repeat(4096)});
  log.snapshot({registers: {pc: '0x40000000'}, buffer: new Uint8Array([0xde, 0xad, 0xbe, 0xef])});
  assert.equal(storage.writes, 2); // start and first failure, independent of volume
  log.finish('failed');
  const restored = new DiagnosticRecorder({storage}).text();
  assert.match(restored, /First checkpoint/);
  assert.match(restored, /Original failure/);
  assert.match(restored, /diagnostics\.test\.mjs:\d+:\d+/);
  assert.match(restored, /earlier event\(s\) omitted/);
  assert.match(restored, /tail 500/);
  assert.match(restored, /0x40000000/);
  assert.match(restored, /binary data omitted, 4 bytes/);
  assert.doesNotMatch(restored, /tail 3\n/);
  assert.ok(restored.length < 90000);
});

test('unavailable storage and cyclic details still produce an exportable report', () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const log = new DiagnosticRecorder({storage});
  log.start('no-storage');
  assert.equal(log.storageAvailable, false);
  const error = new Error('WebGL error', {cause: new Error('context lost')});
  const meta = {blob: new Blob(['PRIVATE BYTES'])};
  meta.loop = meta;
  log.event('error', 'graphics', 'Frame failed', error);
  log.event('info', 'files', 'Metadata', meta);
  log.finish('failed');
  const output = log.text();
  assert.match(output, /context lost/);
  assert.match(output, /Local log storage unavailable/);
  assert.match(output, /circular/);
  assert.match(output, /file data omitted, 13 bytes/);
  assert.doesNotMatch(output, /PRIVATE BYTES/);
  assert.equal(log.text('previous'), '');
});

test('hot-path events are eventually saved without an explicit flush', async () => {
  const storage = new MemoryStorage();
  const log = new DiagnosticRecorder({storage});
  log.start('heartbeat');
  for (let i = 0; i < 8; i++) log.event('info', 'guest', 'heartbeat ' + i);
  assert.equal(storage.writes, 1);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(storage.writes, 2);
  assert.match(new DiagnosticRecorder({storage}).text(), /heartbeat 7/);
  log.finish('stopped');
});

test('two active tabs checkpoint independently; an evicted tab cannot overwrite a newer run', () => {
  const storage = new MemoryStorage();
  const a = new DiagnosticRecorder({storage});
  const b = new DiagnosticRecorder({storage});
  a.start('A');
  b.start('B');
  a.event('info', 'guest', 'A checkpoint');
  a.flush();
  const third = new DiagnosticRecorder({storage});
  assert.match(third.text('previous'), /A checkpoint/);
  third.start('C');
  a.finish('stopped');
  b.event('info', 'guest', 'B checkpoint');
  b.flush();
  const reloaded = new DiagnosticRecorder({storage});
  assert.equal(reloaded.current.label, 'C');
  assert.match(reloaded.text('previous'), /B checkpoint/);
  assert.equal(storage.length, 2);
});

test('corrupt checkpoints do not prevent a new report', () => {
  const storage = new MemoryStorage();
  storage.setItem('bioshock.diagnostics.v1.bogus', '{');
  const log = new DiagnosticRecorder({storage});
  assert.equal(log.current, null);
  log.start('recovery');
  log.finish('completed');
  assert.equal(new DiagnosticRecorder({storage}).current.label, 'recovery');
});

test('a near-full browser store retains a shortened checkpoint of the failure', () => {
  const storage = new MemoryStorage();
  storage.setItem = (key, value) => {
    if (value.length > 14500) throw new DOMException('Full', 'QuotaExceededError');
    storage.data.set(key, value);
  };
  const log = new DiagnosticRecorder({storage});
  log.start('quota-limited.ipa');
  for (let i = 0; i < 30; i++) log.event('debug', 'guest', 'Trace ' + i, {detail: 'x'.repeat(1500)});
  log.event('error', 'dyld', 'Cannot resolve symbol', {symbol: '_missing'});
  log.finish('failed');
  assert.ok(log.storageAvailable);
  assert.doesNotMatch(log.text(), /Storage was low/);
  const recovered = new DiagnosticRecorder({storage}).text();
  assert.match(recovered, /Storage was low/);
  assert.match(recovered, /Cannot resolve symbol/);
  assert.match(recovered, /_missing/);
  assert.match(recovered, /State: failed/);
});
