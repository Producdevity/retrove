import { doubleBits, doubleFromBits, floatBits, floatFromBits } from "../abi/scalars";
import { Argument, type FoundationHost, type HostResult } from "../objc/host";
import { AudioFileStatus, audioStatus } from "../../audio/files/types";
import { PlayerTransport } from "../../audio/player/transport";
import type { PlayerOutput } from "../../audio/player/output";
const PLAYER_CLASS = "AVAudioPlayer";
const FINISHED_SELECTOR = "audioPlayerDidFinishPlaying:successfully:";
const ERROR_DOMAIN = "NSOSStatusErrorDomain";
interface PlayerHost extends Pick<
  FoundationHost,
  "hostClass" | "method" | "destroy" | "retain" | "release" | "write"
> {
  loadURL(url: number): Promise<Uint8Array | undefined>;
  readData(data: number): Uint8Array;
  decode(bytes: Uint8Array): Promise<{ buffer: AudioBuffer; output: PlayerOutput }>;
  error(code: number, domain: string): number;
  send(pointer: number, selector: string, args: number[], optional?: boolean): Promise<HostResult>;
}
interface Player {
  transport: PlayerTransport;
  url: number;
  data: number;
  delegate: number;
}
async function initializePlayer(
  host: PlayerHost,
  players: Map<number, Player>,
  self: number,
  source: number,
  error: number,
  url: boolean,
): Promise<number> {
  if (players.has(self)) throw new Error("AVAudioPlayer cannot be initialized twice.");
  const bytes = url ? await host.loadURL(source) : source ? host.readData(source) : undefined;
  if (!bytes) {
    if (error) host.write(error, host.error(AudioFileStatus.NotFound, ERROR_DOMAIN));
    host.destroy(self);
    return 0;
  }
  let decoded: { buffer: AudioBuffer; output: PlayerOutput };
  try {
    decoded = await host.decode(bytes);
  } catch (failure) {
    if (error)
      host.write(error, host.error(audioStatus(failure) ?? AudioFileStatus.Invalid, ERROR_DOMAIN));
    host.destroy(self);
    return 0;
  }
  let data = 0;
  if (!url) {
    const copied = await host.send(source, "copy", []);
    if (typeof copied !== "number") throw new Error("Expected an NSData copy.");
    data = copied;
  }
  players.set(self, {
    transport: new PlayerTransport(decoded.buffer, decoded.output),
    url: url ? host.retain(source) : 0,
    data,
    delegate: 0,
  });
  return self;
}
function installPlayback(host: PlayerHost, get: (self: number) => Player): void {
  host.method(PLAYER_CLASS, false, "prepareToPlay", (self) =>
    Number(get(self).transport.prepare()),
  );
  host.method(PLAYER_CLASS, false, "play", (self) => Number(get(self).transport.play()));
  host.method(PLAYER_CLASS, false, "playAtTime:", (self, args) =>
    Number(get(self).transport.play(doubleFromBits(args(0), args(1)))),
  );
  host.method(PLAYER_CLASS, false, "pause", (self) => {
    get(self).transport.pause();
  });
  host.method(PLAYER_CLASS, false, "stop", (self) => {
    get(self).transport.stop();
  });
  host.method(PLAYER_CLASS, false, "isPlaying", (self) => Number(get(self).transport.playing));
  host.method(
    PLAYER_CLASS,
    false,
    "numberOfChannels",
    (self) => get(self).transport.buffer.numberOfChannels,
  );
  host.method(PLAYER_CLASS, false, "duration", (self) =>
    doubleBits(get(self).transport.buffer.duration),
  );
  host.method(PLAYER_CLASS, false, "currentTime", (self) =>
    doubleBits(get(self).transport.currentTime),
  );
  host.method(PLAYER_CLASS, false, "setCurrentTime:", (self, args) => {
    get(self).transport.seek(doubleFromBits(args(0), args(1)));
  });
  host.method(PLAYER_CLASS, false, "deviceCurrentTime", (self) =>
    doubleBits(get(self).transport.deviceTime),
  );
}
export function installAudioPlayers(host: PlayerHost) {
  const players = new Map<number, Player>();
  host.hostClass(PLAYER_CLASS, "NSObject");
  const get = (self: number): Player => {
    const p = players.get(self);
    if (!p) throw new Error("AVAudioPlayer has not been initialized with an audio file.");
    return p;
  };
  for (const url of [true, false])
    for (const hint of [false, true]) {
      const selector =
        "initWith" + (url ? "ContentsOfURL:" : "Data:") + (hint ? "fileTypeHint:" : "") + "error:";
      host.method(PLAYER_CLASS, false, selector, (self, args) =>
        initializePlayer(
          host,
          players,
          self,
          args(0),
          args(hint ? Argument.Third : Argument.Second),
          url,
        ),
      );
    }
  host.method(PLAYER_CLASS, false, "dealloc", async (self) => {
    const p = players.get(self);
    if (p) {
      p.transport.stop();
      players.delete(self);
      await host.release(p.url);
      await host.release(p.data);
    }
    host.destroy(self);
  });
  installPlayback(host, get);
  host.method(PLAYER_CLASS, false, "url", (self) => get(self).url);
  host.method(PLAYER_CLASS, false, "data", (self) => get(self).data);
  host.method(PLAYER_CLASS, false, "delegate", (self) => get(self).delegate);
  host.method(PLAYER_CLASS, false, "setDelegate:", (self, args) => {
    get(self).delegate = args(0);
  });
  host.method(PLAYER_CLASS, false, "numberOfLoops", (self) => get(self).transport.numberOfLoops);
  host.method(PLAYER_CLASS, false, "setNumberOfLoops:", (self, args) => {
    get(self).transport.numberOfLoops = args(0) | 0;
  });
  host.method(PLAYER_CLASS, false, "enableRate", (self) => Number(get(self).transport.enableRate));
  host.method(PLAYER_CLASS, false, "setEnableRate:", (self, args) => {
    get(self).transport.enableRate = !!args(0);
  });
  for (const property of ["volume", "pan", "rate"] as const) {
    host.method(PLAYER_CLASS, false, property, (self) => floatBits(get(self).transport[property]));
    host.method(
      PLAYER_CLASS,
      false,
      "set" + property[0]?.toUpperCase() + property.slice(1) + ":",
      (self, args) => {
        get(self).transport[property] = floatFromBits(args(0));
      },
    );
  }
  return {
    async pump(): Promise<void> {
      for (const [self, p] of [...players])
        if (p.transport.takeCompletion() && p.delegate)
          await host.send(p.delegate, FINISHED_SELECTOR, [self, 1], true);
    },
    pending: () =>
      [...players.values()].some((p) => p.transport.playing || p.transport.completionPending),
    snapshot: () => ({
      players: players.size,
      playing: [...players.values()].filter((p) => p.transport.playing).length,
    }),
    close(): void {
      for (const p of players.values()) p.transport.stop();
      players.clear();
    },
  };
}
