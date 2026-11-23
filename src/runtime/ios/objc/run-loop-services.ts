import { decodePlayerAudio } from "../../audio/player/decoder";
import { WebPlayerOutput } from "../../audio/player/output";
import { inspectAudioFile } from "../../audio/files/audio-file";
import { installCFNetwork } from "../cfnetwork/bindings";
import { bundleFunctions } from "../foundation/cf-bundle";
import { DataField } from "../foundation/data";
import { RunLoopMode } from "../foundation/ports";
import { RunLoopSources, runLoopSourceFunctions } from "../foundation/run-loop-sources";
import { foundationRunLoop, type RunLoop } from "../foundation/runloop";
import { installAudioPlayers } from "../media/audio-player";
import { installMusicPlayer } from "../media/music-player";
import { installAccelerometer } from "../uikit/motion/accelerometer";
import type { ObjcCore } from "./core";
import { standardHost } from "./core";
import type { DisplayLinks } from "./display-links";
import type { FoundationFrameworks } from "./foundation-frameworks";
import { MAIN_THREAD } from "./object-ownership";
import { pointerResult } from "./runtime-types";

const UI_MODES = new Set<string>([RunLoopMode.Default, RunLoopMode.Common]);
export type AudioPlayers = ReturnType<typeof installAudioPlayers>;
export type Accelerometer = ReturnType<typeof installAccelerometer>;
export interface RunLoopServices {
  readonly audioPlayers: AudioPlayers;
  readonly accelerometer: Accelerometer;
  readonly scheduler: RunLoop;
  readonly runLoopSources: RunLoopSources;
  /** CFNetwork's exported integer constants. */
  readonly networkData: (name: string) => number | undefined;
}
function dataBytes({ memory }: ObjcCore, pointer: number): Uint8Array {
  return memory.bytes(
    memory.read(pointer + DataField.Bytes),
    memory.read(pointer + DataField.Length),
  );
}
/** MPMusicPlayerController, AVAudioPlayer and UIAccelerometer. */
function installMedia(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
): Pick<RunLoopServices, "audioPlayers" | "accelerometer"> {
  const { messenger, options } = core;
  const host = standardHost(core);
  const send = async (receiver: number, selector: string, args?: number[]) =>
    pointerResult(await messenger.send(receiver, selector, args));
  installMusicPlayer(host);
  const audioPlayers = installAudioPlayers({
    ...host,
    error: (code, domain) => frameworks.files.error(code, domain),
    loadURL: async (url) =>
      url && (await messenger.send(url, "isFileURL"))
        ? frameworks.files.contents(await send(url, "path"))
        : undefined,
    readData: (pointer) => dataBytes(core, pointer),
    decode: async (bytes) => {
      const context = options.audioOutput();
      if (!context || context.state === "closed") throw new Error("Audio output is unavailable");
      return {
        buffer: await decodePlayerAudio(bytes, context, (source) =>
          inspectAudioFile((offset, length) => source.read(offset, length), source.size),
        ),
        output: new WebPlayerOutput(context),
      };
    },
  });
  const accelerometer = installAccelerometer({ ...host, send });
  return { audioPlayers, accelerometer };
}
/** CFRunLoopSource and the run loop functions CoreFoundation exports. */
function installSources(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
  displays: DisplayLinks,
  scheduler: RunLoop,
  pumpNestedUI: () => Promise<void>,
): RunLoopSources {
  const { memory, ownership, messenger, guest, late } = core;
  const sources = (late.bindings.runLoopSources = new RunLoopSources({
    ...standardHost(core),
    read: memory.read,
    callGuest: guest.callGuest,
    currentLoop: () => displays.getRunLoop(),
    poll: async (loop, mode) => {
      const thread = ownership.threadId(),
        delivered = await scheduler.pollThread(thread, mode);
      if (thread === MAIN_THREAD && UI_MODES.has(mode)) await pumpNestedUI();
      return (await frameworks.foundation.pollConnections(loop, mode)) || delivered;
    },
    pending: (_, mode) => scheduler.hasThreadSource(ownership.threadId(), mode),
    hasPort: (loop, mode) => frameworks.ports.hasPort(loop, mode),
    addTimer: async (loop, timer, mode) => {
      await messenger.send(loop, "addTimer:forMode:", [timer, mode]);
    },
    removeTimer: (timer) => scheduler.unscheduleTimer(timer),
  }));
  Object.assign(frameworks.cf.funcs, runLoopSourceFunctions(sources, ownership.threadId), {
    _CFRunLoopGetMain: () => displays.getRunLoop(MAIN_THREAD),
  });
  return sources;
}
/** CFNetwork's HTTP messages and streams, then CFBundle, on top of CoreFoundation. */
function installNetwork(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
  sources: RunLoopSources,
): (name: string) => number | undefined {
  const { memory, ownership, strings, messenger, data, guest, ipa, registry } = core;
  const { foundation: objects, input, files, cf } = frameworks;
  const network = installCFNetwork(
    {
      ...standardHost(core),
      read: memory.read,
      zero: memory.zero,
      readBytes: memory.bytes,
      callGuest: guest.callGuest,
      dataBytes: (pointer) => dataBytes(core, pointer),
      ownedData: (bytes) => data.archivedData(bytes),
      ownedDictionary: (entries) => ownership.retain(objects.property(entries)),
      ownedArray: (values) => input.array([...values]),
      ownedURL: async (address) =>
        ownership.retain(
          pointerResult(
            await messenger.send(registry.names.get("NSURL") ?? 0, "URLWithString:", [
              strings.string(address),
            ]),
          ),
        ),
      urlString: async (url) =>
        strings.text(pointerResult(await messenger.send(url, "absoluteString"))),
      error: (domain, code) => ownership.retain(files.error(code, domain)),
    },
    sources,
  );
  Object.assign(cf.funcs, network.functions);
  const version = ipa.info["CFBundleVersion"];
  Object.assign(
    cf.funcs,
    bundleFunctions({
      version: typeof version === "string" ? version : undefined,
      mainBundle: async () =>
        pointerResult(await messenger.send(registry.names.get("NSBundle") ?? 0, "mainBundle")),
      readBytes: memory.bytes,
      fileURL: async (path, directory) =>
        ownership.retain(
          pointerResult(
            await messenger.send(registry.names.get("NSURL") ?? 0, "fileURLWithPath:isDirectory:", [
              strings.string(path),
              Number(directory),
            ]),
          ),
        ),
    }),
  );
  return (name) => network.data(name);
}
/** Media players, the Foundation run loop, CFRunLoopSource and CFNetwork, in registration order. */
export function installRunLoopServices(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
  displays: DisplayLinks,
  pumpNestedUI: () => Promise<void>,
): RunLoopServices {
  const { registry, messenger, memory, guest, late } = core;
  const { audioPlayers, accelerometer } = installMedia(core, frameworks);
  const scheduler = (late.bindings.scheduler = foundationRunLoop({
    ...standardHost(core),
    cpu: guest.cpu,
    names: registry.names,
    send: messenger.send,
    threads: guest.threads,
    read: memory.read,
    callGuest: guest.callGuest,
    withAnimation: frameworks.input.withAnimation,
    threadIdentity: frameworks.foundation.threadIdentity,
    getDispatch: late.dispatch,
  }));
  const runLoopSources = installSources(core, frameworks, displays, scheduler, pumpNestedUI);
  const networkData = installNetwork(core, frameworks, runLoopSources);
  return { audioPlayers, accelerometer, scheduler, runLoopSources, networkData };
}
