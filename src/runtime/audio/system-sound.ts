import type { GuestMemory } from "../memory/guest-memory";
import { write32 } from "../memory/guest-memory";
import type { GuestArguments } from "../ios/objc/host";
import type { AudioContextSource, GuestCall } from "./guest-host";

const FIRST_SOUND_ID = 1000;
const MAX_SECONDS = 30;
const Status = { Parameter: -50, BadSound: -1500, BadMode: -1501 } as const;
const CompletionArgument = { Sound: 0, RunLoop: 1, Mode: 2, Callback: 3, Reference: 4 } as const;
const PathArgument = { URL: 0, Output: 1 } as const;

export interface SystemSoundArchive {
  has(path: string): boolean;
  read(path: string): Promise<Uint8Array<ArrayBuffer>>;
}
type SoundImport = (args: GuestArguments) => number | void | Promise<number>;
interface SystemSound {
  buffer: AudioBuffer;
  ctx: AudioContext;
  source: AudioBufferSourceNode | null;
  callback: number;
  ref: number;
  completed: boolean;
}

function stop(sound: SystemSound): void {
  if (!sound.source) return;
  sound.source.onended = null;
  sound.source.stop();
  sound.source.disconnect();
  sound.source = null;
}

async function decodeSound(
  archive: SystemSoundArchive,
  ctx: AudioContext,
  path: string,
): Promise<AudioBuffer | null> {
  try {
    const bytes = await archive.read(path);
    const buffer = await ctx.decodeAudioData(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    return buffer.duration > MAX_SECONDS ? null : buffer;
  } catch {
    return null;
  }
}

function play(sound: SystemSound): void {
  stop(sound);
  sound.completed = false;
  const source = sound.ctx.createBufferSource();
  source.buffer = sound.buffer;
  source.connect(sound.ctx.destination);
  source.onended = () => {
    source.disconnect();
    sound.source = null;
    sound.completed = true;
  };
  sound.source = source;
  source.start();
}

/**
 * Audio Services owns the decoded clip. Guest completions run on the application
 * thread when the scheduler next polls, outside the Web Audio event callback.
 */
export function systemSounds(
  cpu: GuestMemory,
  ipa: SystemSoundArchive,
  audioContext: AudioContextSource,
  fileURLPath: (url: number) => Promise<string | null>,
  callGuest: GuestCall,
) {
  const sounds = new Map<number, SystemSound>();
  let next = FIRST_SOUND_ID,
    pumping = false;
  const funcs: Record<string, SoundImport> = {
    _AudioServicesCreateSystemSoundID: async (args) => {
      const url = args(PathArgument.URL),
        output = args(PathArgument.Output);
      if (!output) return Status.Parameter;
      write32(cpu, output, 0);
      if (!url) return Status.Parameter;
      const path = (await fileURLPath(url))?.replace(/^\/+/, ""),
        ctx = audioContext();
      if (!path || !ctx || !ipa.has(path)) return Status.BadSound;
      const buffer = await decodeSound(ipa, ctx, path);
      if (!buffer) return Status.BadSound;
      const id = ++next;
      sounds.set(id, { buffer, ctx, source: null, callback: 0, ref: 0, completed: false });
      write32(cpu, output, id);
      return 0;
    },
    _AudioServicesDisposeSystemSoundID: (args) => {
      const sound = sounds.get(args(0));
      if (!sound) return Status.BadSound;
      stop(sound);
      sounds.delete(args(0));
      return 0;
    },
    _AudioServicesPlaySystemSound: (args) => {
      const sound = sounds.get(args(0));
      if (sound) play(sound);
    },
    _AudioServicesAddSystemSoundCompletion: (args) => {
      const sound = sounds.get(args(CompletionArgument.Sound));
      if (!args(CompletionArgument.Callback)) return Status.Parameter;
      if (args(CompletionArgument.RunLoop) || args(CompletionArgument.Mode)) return Status.BadMode;
      if (!sound) return Status.BadSound;
      sound.callback = args(CompletionArgument.Callback);
      sound.ref = args(CompletionArgument.Reference);
      return 0;
    },
    _AudioServicesRemoveSystemSoundCompletion: (args) => {
      const sound = sounds.get(args(0));
      if (sound) sound.callback = 0;
    },
  };
  return {
    funcs,
    async pump(): Promise<void> {
      if (pumping) return;
      pumping = true;
      try {
        for (const [id, sound] of sounds) {
          if (!sound.completed) continue;
          sound.completed = false;
          if (sound.callback) await callGuest(sound.callback, [id, sound.ref]);
        }
      } finally {
        pumping = false;
      }
    },
    close(): void {
      for (const sound of sounds.values()) stop(sound);
      sounds.clear();
    },
  };
}
