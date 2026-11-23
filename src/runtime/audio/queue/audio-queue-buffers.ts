import type { GuestMemory } from "../../memory/guest-memory";
import { read32, write32 } from "../../memory/guest-memory";
import type { GuestArguments } from "../../ios/objc/host";
import type { GuestCall, GuestHeap } from "../guest-host";
import {
  decodeSamples,
  pcmCodec,
  queueFormat,
  validFormat,
  FORMAT_BYTES,
} from "./audio-queue-format";
import { QueueStatus, recycled } from "./audio-queue-state";
import type { AudioQueue } from "./audio-queue-state";

export type QueueImport = (args: GuestArguments) => number | Promise<number>;
export interface QueueContext {
  cpu: GuestMemory;
  heap: GuestHeap;
  callGuest: GuestCall;
  queues: Map<number, AudioQueue>;
}

const Header = {
  Capacity: 0,
  Data: 4,
  Length: 8,
  Descriptions: 16,
  DescriptionsAt: 20,
  Size: 28,
} as const;
const AllocateArgument = { Capacity: 1, Count: 2, Output: 2, DescribedOutput: 3 } as const;
const RenderArgument = { Buffer: 2, Frames: 3 } as const;
const BUFFER_SLACK = 3;
const DESCRIPTION_BYTES = 16;
const WORD_BYTES = 4;
const BYTE_BITS = 8;

function allocate(context: QueueContext, args: GuestArguments, described: boolean): number {
  const { cpu, heap, queues } = context;
  const queue = queues.get(args(0)),
    capacity = args(AllocateArgument.Capacity),
    count = described ? args(AllocateArgument.Count) : 0,
    output = args(described ? AllocateArgument.DescribedOutput : AllocateArgument.Output);
  if (!queue || !capacity || !output) return QueueStatus.Invalid;
  const pointer = heap.zero(Header.Size + capacity + BUFFER_SLACK + count * DESCRIPTION_BYTES);
  if (!pointer) return QueueStatus.Memory;
  const data = pointer + Header.Size,
    desc = count ? Math.ceil((data + capacity) / WORD_BYTES) * WORD_BYTES : 0;
  write32(cpu, pointer + Header.Capacity, capacity);
  write32(cpu, pointer + Header.Data, data);
  write32(cpu, pointer + Header.Descriptions, count);
  write32(cpu, pointer + Header.DescriptionsAt, desc);
  queue.buffers.set(pointer, { cap: capacity, data, desc });
  write32(cpu, output, pointer);
  return 0;
}

function enqueue(context: QueueContext, args: GuestArguments): number {
  const queue = context.queues.get(args(0)),
    pointer = args(1),
    buffer = queue?.buffers.get(pointer);
  if (!queue || !buffer) return QueueStatus.InvalidBuffer;
  if (queue.active.has(pointer)) return QueueStatus.AlreadyEnqueued;
  const length = read32(context.cpu, pointer + Header.Length);
  if (!length) return QueueStatus.EmptyBuffer;
  if (length > buffer.cap) return QueueStatus.Invalid;
  const samples = decodeSamples(queue.f, context.cpu.read(buffer.data, length), queue.ima);
  if (!samples?.length) return QueueStatus.Codec;
  queue.items.push({ p: pointer, samples, pos: 0 });
  queue.active.add(pointer);
  return 0;
}

function setOfflineFormat(context: QueueContext, args: GuestArguments): number {
  const queue = context.queues.get(args(0));
  if (!queue) return QueueStatus.Invalid;
  if (queue.started) return QueueStatus.Running;
  if (!args(1)) {
    queue.offline = null;
    return 0;
  }
  const format = queueFormat(context.cpu.read(args(1), FORMAT_BYTES)),
    codec = pcmCodec(format);
  if (
    !validFormat(format) ||
    !codec ||
    format.channels !== queue.f.channels ||
    format.rate !== queue.f.rate
  )
    return QueueStatus.Codec;
  queue.offline = { format, codec };
  return 0;
}

async function offlineRender(context: QueueContext, args: GuestArguments): Promise<number> {
  const { cpu, callGuest } = context;
  const queue = context.queues.get(args(0)),
    pointer = args(RenderArgument.Buffer),
    buffer = queue?.buffers.get(pointer),
    frames = args(RenderArgument.Frames);
  if (!queue?.offline) return QueueStatus.NotOffline;
  if (!buffer) return QueueStatus.InvalidBuffer;
  const { format, codec } = queue.offline,
    bytes = frames * format.frameBytes;
  if (bytes > buffer.cap || queue.active.has(pointer)) return QueueStatus.Invalid;
  if (!queue.started && frames) return QueueStatus.Running;
  const output = new Uint8Array(bytes),
    view = new DataView(output.buffer),
    wanted = frames * format.channels;
  let written = 0;
  for (let item = queue.items[0]; written < wanted && item; item = queue.items[0]) {
    const end = Math.min(item.samples.length, item.pos + wanted - written);
    while (item.pos < end)
      codec.set(view, (written++ * format.bits) / BYTE_BITS, item.samples[item.pos++] ?? 0);
    if (item.pos === item.samples.length) {
      queue.items.shift();
      await recycled(callGuest, queue, item);
    }
  }
  const length = (written * format.bits) / BYTE_BITS;
  if (length) cpu.write(buffer.data, output.subarray(0, length));
  write32(cpu, pointer + Header.Length, length);
  return 0;
}

export function bufferImports(context: QueueContext): Record<string, QueueImport> {
  const { heap, queues } = context;
  return {
    _AudioQueueAllocateBuffer: (args) => allocate(context, args, false),
    _AudioQueueAllocateBufferWithPacketDescriptions: (args) => allocate(context, args, true),
    _AudioQueueSetOfflineRenderFormat: (args) => setOfflineFormat(context, args),
    _AudioQueueEnqueueBuffer: (args) => enqueue(context, args),
    _AudioQueueFreeBuffer: (args) => {
      const queue = queues.get(args(0)),
        pointer = args(1);
      if (!queue) return QueueStatus.Invalid;
      if (!queue.buffers.has(pointer)) return QueueStatus.InvalidBuffer;
      if (queue.active.has(pointer)) return QueueStatus.BufferInQueue;
      queue.buffers.delete(pointer);
      heap.free(pointer);
      return 0;
    },
    _AudioQueueOfflineRender: (args) => offlineRender(context, args),
  };
}
