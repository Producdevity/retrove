import type { GuestMemory } from "../../memory/guest-memory";
import { write32 } from "../../memory/guest-memory";
import type { GuestArguments } from "../../ios/objc/host";
import { IMA4Decoder } from "../codecs/ima4";
import type { AudioContextSource, GuestCall, GuestHeap } from "../guest-host";
import { tag } from "../files/audio-file-format";
import { bufferImports } from "./audio-queue-buffers";
import type { QueueContext, QueueImport } from "./audio-queue-buffers";
import {
  FORMAT_BYTES,
  IMA4,
  imaFormat,
  pcmCodec,
  queueFormat,
  validFormat,
} from "./audio-queue-format";
import { discard, QueueStatus, recycled, startNode, suspend } from "./audio-queue-state";
import type { AudioQueue } from "./audio-queue-state";

/** kAudioQueueParam_Volume, the only AudioQueue parameter output queues honor here. */
const VOLUME = 1;
const COOKIE_PROPERTY = tag("aqmc");
const SCHEDULE_AHEAD = 0.12;
const Argument = { Format: 0, Callback: 1, User: 2, Output: 6 } as const;
const Parameter = { Value: 2 } as const;
const Property = { Data: 2, Size: 3 } as const;
const floatBits = new DataView(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT));

function newOutput(context: QueueContext, args: GuestArguments, next: () => number): number {
  const { cpu, queues } = context;
  const output = args(Argument.Output);
  if (!args(Argument.Format) || !output) return QueueStatus.Invalid;
  write32(cpu, output, 0);
  const format = queueFormat(cpu.read(args(Argument.Format), FORMAT_BYTES));
  if (!validFormat(format) || (!pcmCodec(format) && !imaFormat(format))) return QueueStatus.Codec;
  const id = next();
  queues.set(id, {
    id,
    f: format,
    ima: format.id === IMA4 ? new IMA4Decoder(format.channels) : null,
    callback: args(Argument.Callback),
    user: args(Argument.User),
    buffers: new Map(),
    nodes: new Set(),
    items: [],
    ended: [],
    active: new Set(),
    scheduled: new Map(),
    volume: 1,
    started: false,
    stopping: false,
    disposing: false,
    time: 0,
    output: undefined,
    offline: null,
    cookie: undefined,
  });
  write32(cpu, output, id);
  return 0;
}

function parameterImports(context: QueueContext): Record<string, QueueImport> {
  const { cpu, queues } = context;
  return {
    _AudioQueueSetParameter: (args) => {
      const queue = queues.get(args(0));
      if (!queue || args(1) !== VOLUME) return QueueStatus.Invalid;
      floatBits.setUint32(0, args(Parameter.Value), true);
      const volume = floatBits.getFloat32(0, true);
      if (!Number.isFinite(volume)) return QueueStatus.Invalid;
      queue.volume = Math.max(0, Math.min(1, volume));
      if (queue.output) queue.output.gain.value = queue.volume;
      return 0;
    },
    _AudioQueueGetParameter: (args) => {
      const queue = queues.get(args(0));
      if (!queue || args(1) !== VOLUME) return QueueStatus.Invalid;
      if (args(Parameter.Value)) {
        floatBits.setFloat32(0, queue.volume, true);
        write32(cpu, args(Parameter.Value), floatBits.getUint32(0, true));
      }
      return 0;
    },
    _AudioQueueSetProperty: (args) => {
      const queue = queues.get(args(0));
      if (!queue) return QueueStatus.Invalid;
      if (args(1) !== COOKIE_PROPERTY) return QueueStatus.BadProperty;
      queue.cookie = cpu.read(args(Property.Data), args(Property.Size));
      return 0;
    },
  };
}

function transportImports(
  context: QueueContext,
  audio: AudioContextSource,
  dispose: (queue: AudioQueue) => void,
): Record<string, QueueImport> {
  const { queues } = context;
  const withQueue =
    (action: (queue: AudioQueue, args: GuestArguments) => number): QueueImport =>
    (args) => {
      const queue = queues.get(args(0));
      return queue ? action(queue, args) : QueueStatus.Invalid;
    };
  return {
    _AudioQueueStart: withQueue((queue) => {
      const current = audio();
      if (!queue.offline && (!current || current.state === "closed")) return QueueStatus.NoDevice;
      queue.started = true;
      queue.stopping = false;
      return 0;
    }),
    _AudioQueueStop: withQueue((queue, args) => {
      if (args(1)) {
        discard(queue);
        queue.started = false;
      } else {
        queue.stopping = true;
        if (!queue.active.size) queue.started = false;
      }
      return 0;
    }),
    _AudioQueuePause: withQueue((queue) => {
      suspend(queue);
      return 0;
    }),
    // The supported packet decoders have no internal delay.
    _AudioQueueFlush: withQueue(() => 0),
    _AudioQueueDispose: withQueue((queue, args) => {
      if (!args(1) && queue.active.size) {
        queue.disposing = true;
        queue.stopping = true;
        return 0;
      }
      dispose(queue);
      return 0;
    }),
  };
}

export function audioQueues(
  cpu: GuestMemory,
  heap: GuestHeap,
  callGuest: GuestCall,
  audio: AudioContextSource,
) {
  const queues = new Map<number, AudioQueue>(),
    context: QueueContext = { cpu, heap, callGuest, queues };
  let serial = 0,
    servicing = false;
  function dispose(queue: AudioQueue): void {
    queues.delete(queue.id);
    discard(queue);
    queue.output?.disconnect();
    for (const pointer of queue.buffers.keys()) heap.free(pointer);
    queue.buffers.clear();
  }
  const funcs: Record<string, QueueImport> = {
    _AudioQueueNewOutput: (args) => newOutput(context, args, () => ++serial),
    ...bufferImports(context),
    ...parameterImports(context),
    ...transportImports(context, audio, dispose),
  };
  async function service(queue: AudioQueue): Promise<void> {
    for (const item of queue.ended.splice(0)) await recycled(callGuest, queue, item);
    if (queue.disposing && !queue.active.size) return dispose(queue);
    if (queue.stopping && !queue.active.size) queue.started = false;
    if (!queue.started || queue.offline) return;
    const current = audio();
    if (!current || current.state !== "running") return;
    for (
      let item = queue.items[0];
      item && queue.time < current.currentTime + SCHEDULE_AHEAD;
      item = queue.items[0]
    ) {
      queue.items.shift();
      startNode(queue, item, current);
    }
  }
  async function pump(): Promise<void> {
    if (servicing) return;
    servicing = true;
    try {
      for (const queue of queues.values()) await service(queue);
    } finally {
      servicing = false;
    }
  }
  return {
    funcs,
    pump,
    close(): void {
      for (const queue of queues.values()) dispose(queue);
    },
  };
}
