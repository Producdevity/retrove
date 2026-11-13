import {phoneScreen, initialOrientation} from './screen.mjs';
import {DiagnosticRecorder} from './diagnostics.mjs';

const el = id => document.getElementById(id);
const EXPECTED_PIXEL = '51,102,153,255';
const STALL_MS = 15000;

function describeBrowser(build) {
  return {
    build, browser: navigator.userAgent, viewport: [innerWidth, innerHeight],
    pixelRatio: devicePixelRatio, webAssembly: typeof WebAssembly === 'object',
    webGLAPI: typeof WebGLRenderingContext === 'function',
    decompressionStream: typeof DecompressionStream === 'function',
    audioContext: typeof AudioContext === 'function', secureContext: window.isSecureContext
  };
}

async function openInput(file, diagnostic) {
  diagnostic('info', 'input', 'Checking file format', {file: file.name || 'self-test.ipa', bytes: file.size});
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (magic[0] === 0x50 && magic[1] === 0x4b) {
    const {openIPA} = await import('./ipa.mjs');
    return openIPA(file, diagnostic);
  }
  if (file.size > 512 * 1024 * 1024) throw Error('Expected an IPA (ZIP) or an executable under 512 MiB.');
  const name = file.name || 'Executable';
  diagnostic('info', 'input', 'Opening as a standalone executable');
  return {bundlePath: 'Payload/Local.app', executablePath: 'Payload/Local.app/' + name,
    info: {CFBundleExecutable: name}, has: () => false, readExecutable: async () => new Uint8Array(await file.arrayBuffer())};
}

export function initialize(build, setExport) {
  const logs = new DiagnosticRecorder();
  const startupPicker = el('startup-file'), startupDownload = el('startup-download');
  let startupURL;
  startupPicker.addEventListener('change', async () => {
    const file = startupPicker.files[0];
    if (!file) return;
    const status = el('startup-status');
    startupPicker.disabled = true;
    startupDownload.hidden = true;
    if (startupURL) URL.revokeObjectURL(startupURL);
    startupDownload.removeAttribute('href');
    status.textContent = 'Reading the startup files…';
    try {
      const {createStartupZip} = await import('./startup-zip.mjs');
      const {blob, filename} = await createStartupZip(file);
      startupURL = URL.createObjectURL(blob);
      startupDownload.href = startupURL;
      startupDownload.download = filename;
      startupDownload.hidden = false;
      status.textContent = (blob.size / 1048576).toFixed(1) + ' MiB ready. Tap Download startup ZIP to save it.';
    } catch (err) {
      status.textContent = String(err?.message || err);
    } finally {
      startupPicker.value = '';
      startupPicker.disabled = false;
    }
  });
  startupPicker.disabled = false;
  const panel = el('diagnostics'), field = el('log'), session = el('session');
  if (location.hash === '#diagnostics') panel.open = true;
  let active, renderTimer;
  const selected = () => session.value === 'previous' && logs.previous ? 'previous' : 'current';
  setExport(() => logs.text(selected()), () => 'bioshock-' + logs[selected()].id + '.txt');

  function render(force = false) {
    const record = logs[selected()];
    session.hidden = !logs.previous;
    session.options[0].textContent = 'Latest run' + (logs.current ? ' · ' + logs.current.state : '');
    session.options[1].textContent = 'Previous run' + (logs.previous ? ' · ' + logs.previous.state : '');
    field.hidden = !record;
    el('copy').disabled = el('save').disabled = !record;
    el('mark').hidden = !active || selected() !== 'current';
    const hint = !record ? 'After a run, you can copy its log here.'
      : !logs.storageAvailable ? 'Browser storage is unavailable. Copy this log before leaving the page.'
      : record.state === 'interrupted' ? 'This run ended without a final event. Its last saved checkpoint is below.'
      : 'Logs stay on this device. Copy the log or attach the .txt in chat.';
    el('log-hint').textContent = hint;
    if (!record || !panel.open || (!force && document.activeElement === field)) return;
    const follow = field.scrollHeight - field.scrollTop - field.clientHeight < 8;
    const top = field.scrollTop;
    const next = logs.text(selected());
    if (field.value !== next) {
      field.value = next;
      field.scrollTop = follow ? field.scrollHeight : top;
    }
  }
  function queueRender() {
    if (renderTimer || !panel.open) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 500);
  }
  panel.addEventListener('toggle', () => { if (panel.open) render(true); });
  field.addEventListener('blur', () => queueRender());
  session.addEventListener('change', () => { el('feedback').textContent = ''; render(true); });

  function event(run, level, area, message, details) {
    if (active !== run) return;
    logs.event(level, area, message, details);
    // Save immediately before expensive work, so Safari can terminate a tab
    // without taking its entire startup trace with it.
    if (level === 'error' || (level === 'info' && area !== 'guest-output' && area !== 'heartbeat')) logs.flush();
    queueRender();
  }
  function milestone(run, text) {
    run.stage = text;
    run.stageAt = performance.now();
    run.stallWarned = false;
    el('status').textContent = text;
  }
  function watchdog(run) {
    if (document.hidden) return;
    const now = performance.now();
    const snapshot = run.snapshot;
    const quietFor = Math.round((now - Math.max(run.stageAt, run.progressAt)) / 1000);
    if (!run.stallWarned && quietFor * 1000 >= STALL_MS) {
      run.stallWarned = true;
      event(run, 'warn', 'watchdog', 'No forward progress observed', {seconds: quietFor, stage: run.stage, activeImports: snapshot?.activeImports, pc: snapshot?.registers?.pc});
      logs.flush();
    }
    if (snapshot?.cpuSlices > 0 && snapshot.render && !run.frameWarned && now - run.frameAt >= STALL_MS) {
      run.frameWarned = true;
      event(run, 'warn', 'graphics', run.frames ? 'No further EAGL frame presentations observed' : 'No EAGL frame presentation observed yet',
        {seconds: Math.round((now - run.frameAt) / 1000), phase: snapshot.phase, ...snapshot.render});
      logs.flush();
    }
  }
  function observe(run, snapshot) {
    if (active !== run) return;
    const now = performance.now();
    const previous = run.snapshot;
    if (!previous || snapshot.phase !== previous.phase || snapshot.cpuSlices !== previous.cpuSlices ||
        snapshot.calls !== previous.calls || snapshot.render?.presentedFrames !== previous.render?.presentedFrames) {
      run.progressAt = now;
      run.stallWarned = false;
    }
    const executionStarted = !previous?.cpuSlices && snapshot.cpuSlices > 0;
    if (snapshot.render && (executionStarted || snapshot.render.presentedFrames !== run.frames)) {
      run.frameAt = now;
      run.frameWarned = false;
      run.frames = snapshot.render.presentedFrames;
    }
    run.snapshot = snapshot;
    run.snapshotAt = now;
    logs.snapshot(snapshot);
    if (snapshot.fault) logs.flush();
    if (now - run.sampleAt >= STALL_MS) {
      run.sampleAt = now;
      event(run, 'debug', 'heartbeat', 'Guest checkpoint', {phase: snapshot.phase,
        pc: snapshot.registers?.pc, calls: snapshot.calls, cpuSlices: snapshot.cpuSlices,
        activeImports: snapshot.activeImports, render: snapshot.render});
    }
    queueRender();
  }
  function graphics(run) {
    if (run.gl) return run.gl;
    event(run, 'info', 'graphics', 'Creating WebGL context');
    const canvas = document.createElement('canvas');
    const {width, height, scale} = phoneScreen;
    const landscape = run.orientation > 2;
    canvas.width = (landscape ? height : width) * scale;
    canvas.height = (landscape ? width : height) * scale;
    canvas.addEventListener('webglcontextcreationerror', e => event(run, 'warn', 'graphics', 'WebGL context creation error', e.statusMessage));
    canvas.addEventListener('webglcontextlost', e => {
      if (active !== run) return;
      const error = Error('WebGL context lost' + (e.statusMessage ? ' · ' + e.statusMessage : ''));
      event(run, 'error', 'graphics', error.message);
      run.failure = error;
      run.controller.abort(error);
    });
    const attributes = {alpha: false, antialias: false, preserveDrawingBuffer: true};
    const gl = canvas.getContext('webgl2', attributes) || canvas.getContext('webgl', attributes);
    if (!gl) throw Error('WebGL could not start on this device.');
    el('display').prepend(canvas);
    run.gl = gl;
    event(run, 'info', 'graphics', 'WebGL context ready', {version: gl.getParameter(gl.VERSION),
      shaderLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      width: gl.drawingBufferWidth, height: gl.drawingBufferHeight});
    return gl;
  }

  async function start(getFile, label, selfTest = false) {
    if (active) return;
    const now = performance.now();
    const run = {controller: new AbortController(), stageAt: now, snapshotAt: now, progressAt: now, frameAt: now, sampleAt: now, frames: 0};
    active = run;
    const signal = run.controller.signal;
    logs.start(label, describeBrowser(build));
    session.value = 'current';
    el('feedback').textContent = '';
    el('display').replaceChildren();
    el('stop').hidden = false;
    el('test').disabled = el('file').disabled = true;
    milestone(run, selfTest ? 'Loading the self-test…' : 'Opening the selected file…');
    const diagnostic = (level, area, message, details) => {
      if (level === 'info' && active === run && !['heartbeat', 'graphics', 'audio'].includes(area))
        milestone(run, message);
      event(run, level, area, message, details);
    };
    event(run, 'info', 'browser', run.stage);
    render(true);
    run.watch = setInterval(() => watchdog(run), 3000);
    try {
      if (!selfTest && typeof AudioContext === 'function') {
        try {
          run.sound = new AudioContext();
          run.sound.addEventListener('statechange', () => event(run, 'debug', 'audio', 'Audio context state', run.sound.state));
          run.sound.resume().catch(e => event(run, 'warn', 'audio', 'Could not resume audio', e));
        } catch (e) { event(run, 'warn', 'audio', 'Audio context unavailable', e); }
      }
      const ipa = await openInput(await getFile(), diagnostic);
      run.orientation = initialOrientation(ipa.info);
      signal.throwIfAborted();
      if(ipa.entries?.size === 2 && ipa.entries.has(ipa.bundlePath+'/Info.plist'))
        event(run,'info','input','Startup archive contains the executable and Info.plist. Game assets are absent.');
      const name = ipa.info.CFBundleDisplayName || ipa.info.CFBundleName || ipa.info.CFBundleExecutable;
      milestone(run, 'Starting ' + name + '…');
      event(run, 'info', 'runtime', 'Loading ARM runtime modules', {application: name, version: ipa.info.CFBundleShortVersionString});
      const {runGuest} = await import('./runtime.mjs');
      const result = await runGuest(ipa, {signal, diagnostic, mediaHost: el('display'), report: value => observe(run, value),
        log: message => event(run, 'debug', 'guest-output', message),
        graphics: () => graphics(run), audioContext: () => run.sound});
      signal.throwIfAborted();
      event(run, result.exitStatus === 0 ? 'info' : 'error', 'runtime', 'Guest exited', result);
      if (selfTest) {
        const gl = run.gl, pixel = new Uint8Array(4);
        gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        event(run, 'info', 'self-test', 'WebGL pixel readback', {expected: EXPECTED_PIXEL, actual: pixel.join(',')});
        if (result.exitStatus !== 0 || !gl || pixel.join(',') !== EXPECTED_PIXEL)
          throw Error('Self-test failed during rendered pixel verification.');
      }
      const activity = run.snapshot?.render;
      const noOutput = !selfTest && activity && !activity.presentedFrames && !activity.clearCalls && !activity.drawCalls;
      if (noOutput) event(run, 'warn', 'graphics', 'Guest exited before any draw, clear or frame presentation', activity);
      const message = selfTest ? 'Self-test passed. The ARM guest read its asset and rendered the expected pixel.'
        : 'Guest exited with status ' + result.exitStatus + (noOutput ? ' before rendering a frame.' : '.');
      el('status').textContent = message;
      logs.finish(result.exitStatus === 0 ? 'completed' : 'failed', message);
      if (result.exitStatus !== 0 || noOutput) panel.open = true;
    } catch (caught) {
      const stopped = signal.aborted && !run.failure;
      const error = run.failure || caught;
      const message = stopped ? 'Stopped by user.' : String(error?.message || error);
      event(run, stopped ? 'info' : 'error', 'runtime', message, stopped ? undefined : error);
      logs.finish(stopped ? 'stopped' : 'failed', message);
      el('status').textContent = message;
      session.value = 'current';
      panel.open = true;
    } finally {
      clearInterval(run.watch);
      active = null;
      if (run.sound && run.sound.state !== 'closed') run.sound.close().catch(() => {});
      el('stop').hidden = true;
      el('test').disabled = el('file').disabled = false;
      el('file').value = '';
      render(true);
    }
  }
  el('file').addEventListener('change', () => {
    const file = el('file').files[0];
    if (file) start(() => file, file.name || 'Local executable');
  });
  el('test').addEventListener('click', () => start(async () => {
    const response = await fetch('tests/fixtures/smoke.ipa');
    if (!response.ok) throw Error('Could not load the bundled test IPA (HTTP ' + response.status + ').');
    return response.blob();
  }, 'ARM self-test', true));
  el('stop').addEventListener('click', () => {
    if (!active) return;
    event(active, 'info', 'user', 'Stop requested');
    active.controller.abort();
    el('status').textContent = 'Stopping…';
  });
  el('mark').addEventListener('click', () => {
    if (!active) return;
    event(active, 'warn', 'user', 'User marked a black screen', {phase: active.snapshot?.phase || active.stage,
      render: active.snapshot?.render, checkpointAgeMs: Math.round(performance.now() - active.snapshotAt)});
    logs.flush();
    el('feedback').textContent = 'Black screen marked in the log.';
    render(true);
  });
  function browserError(message, err) {
    if (!active) return;
    event(active, 'error', 'browser', message, err);
    panel.open = true;
  }
  window.addEventListener('error', e => browserError(e.message || 'Uncaught browser error', e.error || {line: e.lineno, column: e.colno}));
  window.addEventListener('unhandledrejection', e => browserError('Unhandled promise rejection', e.reason));
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (!document.hidden) {
      active.stageAt = active.frameAt = performance.now();
      active.frameWarned = active.stallWarned = false;
    }
    event(active, 'debug', 'browser', document.hidden ? 'Page hidden' : 'Page visible');
    logs.flush();
  });
  window.addEventListener('pagehide', () => {
    if (active) event(active, 'debug', 'browser', 'Page leaving during run');
    logs.flush();
  });
  el('test').disabled = el('file').disabled = false;
  if (logs.current?.state === 'interrupted') {
    el('status').textContent = 'The last run was interrupted. Its saved log is open below.';
    panel.open = true;
  } else el('status').textContent = 'Select an IPA from Files. It stays on this device.';
  render(true);
}
