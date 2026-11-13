// Keep copying and saving available even if an ES module cannot load.
(() => {
  const el = id => document.getElementById(id);
  const build = document.querySelector('meta[name="runtime-build"]').content;
  const entry = new URL('app.mjs', document.currentScript.src);
  let getText = () => el('log').value;
  let getFilename = () => 'bioshock-startup.txt';

  function selectForCopy(text) {
    const field = el('log');
    field.value = text;
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    el('feedback').textContent = copied ? 'Log copied.' : 'Log selected. Touch and hold the selection, then tap Copy.';
  }

  el('copy').addEventListener('click', async () => {
    const text = getText();
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) return selectForCopy(text);
      await navigator.clipboard.writeText(text);
      el('feedback').textContent = 'Log copied.';
    } catch { selectForCopy(text); }
  });

  el('save').addEventListener('click', () => {
    const text = getText();
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = getFilename();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    el('feedback').textContent = 'Log file ready. You can attach the .txt in chat.';
  });

  import(entry.href).then(module => module.initialize(build, (text, filename) => {
    getText = text;
    getFilename = filename;
  })).catch(error => {
    const text = ['BioShock runtime | startup failure', 'Build: ' + build,
      new Date().toISOString(), navigator.userAgent, String(error), error?.stack].filter(Boolean).join('\n');
    getText = () => text;
    el('diagnostics').open = true;
    el('status').textContent = 'The runtime interface failed to load.';
    el('log-hint').textContent = 'Copy the startup error and paste it in chat.';
    el('log').value = text;
    el('log').hidden = false;
    el('copy').disabled = el('save').disabled = false;
  });
})();
