import {write32} from '../src/runtime/memory/guest-memory.ts';

// Audio Services owns the decoded clip. Guest completions run on the application
// thread when the scheduler next polls, outside the Web Audio event callback.
export function systemSounds(cpu, ipa, audioContext, fileURLPath, callGuest) {
  const sounds = new Map();
  let next = 1000, pumping = false;
  function stop(sound) {
    if (!sound.source) return;
    sound.source.onended = null;
    sound.source.stop();
    sound.source.disconnect();
    sound.source = null;
  }
  return {
    funcs: {
      _AudioServicesCreateSystemSoundID: async a => {
        const url = a(0), out = a(1);
        if (!out) return -50;
        write32(cpu, out, 0);
        if (!url) return -50;
        const path = (await fileURLPath(url))?.replace(/^\/+/, '');
        const ctx = audioContext();
        if (!path || !ctx || !ipa.has(path)) return -1500;
        let buffer;
        try {
          const bytes = await ipa.read(path);
          buffer = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        } catch { return -1500; }
        if (buffer.duration > 30) return -1500;
        const id = ++next;
        sounds.set(id, {buffer, ctx, source: null, callback: 0, ref: 0, completed: false});
        write32(cpu, out, id);
        return 0;
      },
      _AudioServicesDisposeSystemSoundID: a => {
        const s = sounds.get(a(0));
        if (!s) return -1500;
        stop(s); sounds.delete(a(0)); return 0;
      },
      _AudioServicesPlaySystemSound: a => {
        const s = sounds.get(a(0));
        if (!s) return;
        stop(s); s.completed = false;
        const source = s.ctx.createBufferSource();
        source.buffer = s.buffer; source.connect(s.ctx.destination);
        source.onended = () => { source.disconnect(); s.source = null; s.completed = true; };
        s.source = source; source.start();
      },
      _AudioServicesAddSystemSoundCompletion: a => {
        const s = sounds.get(a(0));
        if (!a(3)) return -50;
        if (a(1) || a(2)) return -1501;
        if (!s) return -1500;
        s.callback = a(3); s.ref = a(4); return 0;
      },
      _AudioServicesRemoveSystemSoundCompletion: a => {
        const s = sounds.get(a(0)); if (s) s.callback = 0;
      }
    },
    async pump() {
      if (pumping) return;
      pumping = true;
      try {
        for (const [id, s] of sounds) {
          if (!s.completed) continue;
          s.completed = false;
          if (s.callback) await callGuest(s.callback, [id, s.ref]);
        }
      } finally { pumping = false; }
    },
    close() { for (const s of sounds.values()) stop(s); sounds.clear(); }
  };
}
