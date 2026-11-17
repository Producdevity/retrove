const PREFIX = 'bioshock.diagnostics.v1.';
const HEAD_COUNT = 12;
const TAIL_COUNT = 150;
const TAIL_BUDGET = 42000;
const WRITE_DELAY_MS = 1000;
const iso = () => new Date().toISOString();

function clip(value, limit) {
  const string = String(value);
  return string.length > limit ? string.slice(0, limit - 12) + ' …[truncated]' : string;
}

// Format at capture time so no live guest objects or game buffers are retained.
function describe(value, limit) {
  if (value === undefined) return '';
  const seen = new WeakSet();
  let nodes = 0;
  function visit(item, depth) {
    if (item == null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (typeof item !== 'object') return clip(item, 1500);
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && item instanceof SharedArrayBuffer)) {
      return '[binary data omitted, ' + item.byteLength + ' bytes]';
    }
    if (typeof Blob !== 'undefined' && item instanceof Blob) return '[file data omitted, ' + item.size + ' bytes]';
    if (depth > 6 || ++nodes > 180) return '[details truncated]';
    if (seen.has(item)) return '[circular]';
    seen.add(item);
    let result;
    if (item instanceof Error) {
      result = {name: clip(item.name, 128), message: clip(item.message, 1500)};
      if (item.stack) result.stack = clip(item.stack, 2500);
      if (item.cause !== undefined) result.cause = visit(item.cause, depth + 1);
      for (const field of ['code', 'faultAddress']) {
        if (item[field] !== undefined) result[field] = visit(item[field], depth + 1);
      }
    } else if (Array.isArray(item)) {
      result = [];
      const count = Math.min(item.length, 40);
      for (let i = 0; i < count; i++) result.push(visit(item[i], depth + 1));
      if (item.length > count) result.push('… ' + (item.length - count) + ' more');
    } else {
      result = Object.create(null);
      let count = 0;
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        if (count++ >= 48) { result['…'] = '[remaining fields omitted]'; break; }
        result[clip(key, 120)] = visit(item[key], depth + 1);
      }
    }
    seen.delete(item);
    return result;
  }
  try {
    if (typeof value === 'string') return clip(value, limit);
    if (value instanceof Error) {
      const error = visit(value, 0);
      return clip([error.name + ': ' + error.message, error.stack,
        error.cause !== undefined ? 'Caused by: ' + JSON.stringify(error.cause) : null,
        error.code !== undefined ? 'Code: ' + error.code : null,
        error.faultAddress !== undefined ? 'Fault address: ' + error.faultAddress : null].filter(Boolean).join('\n'), limit);
    }
    return clip(JSON.stringify(visit(value, 0), null, 2), limit);
  } catch { return '[details unavailable]'; }
}

function storageKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys.sort().reverse();
}

function recover(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 512000) return null;
    const run = JSON.parse(raw);
    if (!run || PREFIX + run.id !== key || typeof run.startedAt !== 'string' ||
        typeof run.label !== 'string' || typeof run.state !== 'string' ||
        !Array.isArray(run.head) || !Array.isArray(run.tail) ||
        ![...run.head, ...run.tail, ...(run.firstError ? [run.firstError] : [])].every(e =>
          e && typeof e.message === 'string' && typeof e.area === 'string' &&
          typeof e.level === 'string' && typeof e.details === 'string' && typeof e.ms === 'number')) return null;
    if (run.state === 'running') run.state = 'interrupted';
    return run;
  } catch { return null; }
}

function lineSize(e) {
  return e.message.length + e.details.length + e.area.length + e.level.length + 64;
}

function formatEntry(e) {
  const prefix = '+' + (e.ms / 1000).toFixed(3) + 's ' + e.level.toUpperCase() + ' [' + e.area + '] ';
  return prefix + e.message + (e.details ? '\n' + e.details : '');
}

// Preserve the failure and end of the timeline when Safari's origin quota is
// nearly full. The export in the currently open tab retains its full detail.
function compactCheckpoint(run) {
  const compact = entry => ({...entry, message: clip(entry.message, 320), details: clip(entry.details, 450)});
  return {...run, linker: undefined, coverage: undefined, metadata: clip(run.metadata, 1000), snapshot: clip(run.snapshot, 4500),
    head: run.head.slice(0, 4).map(compact), tail: [...run.head.slice(4), ...run.tail].slice(-8).map(compact),
    firstError: run.firstError && {...run.firstError, details: clip(run.firstError.details, 1500)},
    compact: true};
}

export class DiagnosticRecorder {
  constructor(options = {}) {
    this.current = null;
    this.previous = null;
    this.storageAvailable = false;
    this.owned = false;
    this.timer = null;
    try {
      this.storage = options.storage === undefined ? globalThis.localStorage : options.storage;
      if (this.storage) {
        const runs = [];
        for (const key of storageKeys(this.storage)) {
          const run = recover(this.storage, key);
          if (run) runs.push(run);
          if (runs.length === 2) break;
        }
        [this.current = null, this.previous = null] = runs;
        this.storageAvailable = true;
      }
    } catch { /* Private modes can reject even reading window.localStorage. */ }
  }

  start(label, metadata) {
    if (this.owned && this.current.state === 'running') this.finish('interrupted');
    this.previous = this.current;
    const startedAt = iso();
    this.storageAvailable = Boolean(this.storage);
    let order = Math.max(Date.now(), Number(this.previous?.id.split('-')[0] || 0) + 1);
    if (this.storageAvailable) {
      try {
        const latest = storageKeys(this.storage)[0];
        if (latest) order = Math.max(order, Number(latest.slice(PREFIX.length).split('-')[0]) + 1 || 0);
      } catch { this.storageAvailable = false; }
    }
    // Individual keys keep one tab's checkpoints from overwriting another tab's run.
    const id = String(order).padStart(14, '0') + '-' + Math.random().toString(36).slice(2, 10);
    this.current = {id, label: clip(label, 180), startedAt, updatedAt: startedAt,
      elapsed: 0, state: 'running', metadata: describe(metadata, 5000), snapshot: '',
      count: 0, head: [], tail: [], firstError: null};
    this.owned = true;
    this.savedOnce = false;
    this.compactWrites = false;
    this.clockStart = performance.now();
    this.tailSize = 0;
    this.dirty = true;
    this.flush();
    return this.current;
  }

  touch() {
    this.current.elapsed = Math.max(0, Math.round(performance.now() - this.clockStart));
    this.current.updatedAt = iso();
    this.dirty = true;
  }

  schedule() {
    if (this.timer !== null || !this.storageAvailable) return;
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
    this.timer?.unref?.();
  }

  event(level, area, message, details) {
    if (!this.owned || this.current.state !== 'running') return;
    this.touch();
    const run = this.current;
    const e = {seq: ++run.count, ms: run.elapsed, level: clip(level, 16).toLowerCase(),
      area: clip(area, 80), message: clip(message, 900), details: describe(details, 3000)};
    if (e.area === 'linker' && details && typeof details === 'string') {
      run.linker = clip(details, 24000);
      e.details = 'See the unresolved import list at the end of this report.';
    }
    if (e.area === 'coverage' && details && typeof details === 'string') {
      run.coverage = clip(details, 24000);
      e.details = 'See the unimplemented class and selector list at the end of this report.';
    }
    if (run.head.length < HEAD_COUNT) run.head.push(e);
    else {
      run.tail.push(e);
      this.tailSize += lineSize(e);
      while (run.tail.length > TAIL_COUNT || this.tailSize > TAIL_BUDGET)
        this.tailSize -= lineSize(run.tail.shift());
    }
    if (!run.firstError && (e.level === 'error' || e.level === 'fatal')) {
      run.firstError = e;
      this.flush();
    } else this.schedule();
  }

  snapshot(value) {
    if (!this.owned || this.current.state !== 'running') return;
    this.touch();
    this.current.snapshot = describe(value, 15000);
    this.schedule();
  }

  finish(state, message) {
    if (!this.owned || this.current.state !== 'running') return;
    if (message) this.event(state === 'failed' ? 'error' : 'info', 'session', message);
    this.touch();
    this.current.state = clip(state, 32);
    this.flush();
  }

  flush() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || !this.owned || !this.storageAvailable) return this.storageAvailable;
    try {
      const key = PREFIX + this.current.id;
      // A newer pair of runs can evict this run from another tab. Its in-memory
      // report remains usable without displacing the newer persisted reports.
      if (this.savedOnce && this.storage.getItem(key) === null) {
        this.storageAvailable = false;
        return false;
      }
      try {
        this.storage.setItem(key, JSON.stringify(this.compactWrites ? compactCheckpoint(this.current) : this.current));
      } catch (err) {
        if (this.compactWrites || !['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(err?.name)) throw err;
        this.compactWrites = true;
        this.storage.setItem(key, JSON.stringify(compactCheckpoint(this.current)));
      }
      if (!this.savedOnce) {
        for (const oldKey of storageKeys(this.storage).slice(2)) this.storage.removeItem(oldKey);
        this.savedOnce = true;
      }
      this.dirty = false;
      return true;
    } catch {
      this.storageAvailable = false;
      return false;
    }
  }

  text(which = 'current') {
    const run = which === 'previous' ? this.previous : this.current;
    if (!run) return '';
    const rows = ['Retrove runtime diagnostics', 'Run: ' + run.id,
      'Input: ' + run.label, 'Started: ' + run.startedAt, 'Last checkpoint: ' + run.updatedAt,
      'State: ' + run.state + ' (+' + (run.elapsed / 1000).toFixed(3) + 's)'];
    if (run.state === 'interrupted')
      rows.push('This run has no recorded exit. This report ends at its last saved checkpoint.');
    if (run.compact) rows.push('Storage was low. This saved checkpoint contains a shortened timeline and snapshot.');
    if (!this.storageAvailable) rows.push('Local log storage unavailable. Copy or save this report before closing.');
    if (run.firstError) rows.push('First error: [' + run.firstError.area + '] ' + run.firstError.message);
    if (run.metadata) rows.push('Environment and input', run.metadata);
    rows.push('', 'Events (' + run.count + ')', ...run.head.map(formatEntry));
    const omitted = run.count - run.head.length - run.tail.length;
    if (omitted > 0) rows.push('… ' + omitted + ' earlier event(s) omitted from the timeline …');
    rows.push(...run.tail.map(formatEntry));
    if (run.firstError && omitted > 0 &&
        ![...run.head, ...run.tail].some(e => e.seq === run.firstError.seq)) {
      rows.push('', 'First error', formatEntry(run.firstError));
    }
    if (run.snapshot) rows.push('', 'Latest runtime snapshot', run.snapshot);
    if (typeof run.linker === 'string') rows.push('', 'Unresolved imports at load time', run.linker);
    if (typeof run.coverage === 'string') rows.push('', 'Unimplemented classes and selectors referenced by the app', run.coverage);
    return rows.join('\n');
  }
}
