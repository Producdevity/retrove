import type { IMA4Decoder } from "../codecs/ima4";
import type { GuestCall } from "../guest-host";
import type { PcmCodec, QueueFormat } from "./audio-queue-format";

export const QueueStatus = {
  Memory: -108,
  Invalid: -66682,
  Codec: -66673,
  InvalidBuffer: -66687,
  BufferInQueue: -66679,
  Running: -66678,
  AlreadyEnqueued: -66666,
  EmptyBuffer: -66686,
  NoDevice: -66680,
  BadProperty: -66684,
  NotOffline: -66626,
} as const;
const SCHEDULE_DELAY = 0.003;

export interface QueueBuffer {
  cap: number;
  data: number;
  desc: number;
}
export interface QueueItem {
  p: number;
  samples: Float32Array;
  pos: number;
}
export interface AudioQueue {
  id: number;
  f: QueueFormat;
  ima: IMA4Decoder | null;
  callback: number;
  user: number;
  buffers: Map<number, QueueBuffer>;
  nodes: Set<AudioBufferSourceNode>;
  items: QueueItem[];
  ended: QueueItem[];
  active: Set<number>;
  scheduled: Map<AudioBufferSourceNode, QueueItem>;
  volume: number;
  started: boolean;
  stopping: boolean;
  disposing: boolean;
  time: number;
  output: GainNode | undefined;
  offline: { format: QueueFormat; codec: PcmCodec } | null;
  cookie: Uint8Array | undefined;
}

export async function recycled(callGuest: GuestCall, queue: AudioQueue, item: QueueItem) {
  queue.active.delete(item.p);
  if (queue.callback) await callGuest(queue.callback, [queue.user, queue.id, item.p]);
}

function stopNodes(queue: AudioQueue): void {
  for (const node of queue.nodes) {
    node.onended = null;
    node.stop();
    node.disconnect();
  }
  queue.nodes.clear();
  queue.scheduled.clear();
}

export function discard(queue: AudioQueue): void {
  stopNodes(queue);
  queue.items = [];
  queue.ended = [];
  queue.active.clear();
  queue.time = 0;
}

/** Web Audio sources cannot pause, so scheduled buffers return to the queue and replay on start. */
export function suspend(queue: AudioQueue): void {
  const pending = [...queue.scheduled.values()];
  stopNodes(queue);
  queue.items.unshift(...pending);
  queue.time = 0;
  queue.started = false;
}

export function startNode(queue: AudioQueue, item: QueueItem, context: AudioContext): void {
  const channels = queue.f.channels,
    buffer = context.createBuffer(channels, item.samples.length / channels, queue.f.rate);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++)
      data[index] = item.samples[index * channels + channel] ?? 0;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  if (!queue.output || queue.output.context !== context) {
    queue.output = context.createGain();
    queue.output.connect(context.destination);
  }
  queue.output.gain.value = queue.volume;
  source.connect(queue.output);
  source.onended = () => {
    source.disconnect();
    queue.nodes.delete(source);
    queue.scheduled.delete(source);
    queue.ended.push(item);
  };
  queue.nodes.add(source);
  queue.scheduled.set(source, item);
  const when = Math.max(queue.time, context.currentTime + SCHEDULE_DELAY);
  source.start(when);
  queue.time = when + buffer.duration;
}
