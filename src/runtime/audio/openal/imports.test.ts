import { expect, test } from "vite-plus/test";
import { floatBits } from "../../ios/abi/scalars";
import { AL, ALError, PCMFormat } from "./constants";
import { openAL } from "./imports";
import type { ALFunction } from "./runtime";
import type { AudioOutput } from "./output";
function fixture() {
  const memory = new Uint8Array(65536),
    view = new DataView(memory.buffer),
    live = new Set<number>(),
    gates = new Map<string, ALFunction>();
  let next = 64,
    time = 0;
  const calls: { gain: number; stopped: boolean }[] = [];
  const output: AudioOutput = {
    get time() {
      return time;
    },
    rate: 8000,
    play: (_pcm, _at, _offset, _duration, properties) => {
      const call = { gain: properties.gain, stopped: false };
      calls.push(call);
      return {
        stop: () => {
          call.stopped = true;
        },
        gain: (value) => {
          call.gain = value;
        },
      };
    },
  };
  const runtime = openAL({
    read: (pointer, length) => memory.slice(pointer, pointer + length),
    readWord: (pointer) => view.getUint32(pointer, true),
    writeWord: (pointer, value) => view.setUint32(pointer, value, true),
    text: (pointer) =>
      new TextDecoder().decode(memory.subarray(pointer, memory.indexOf(0, pointer))),
    string: () => 0,
    allocate: () => {
      const pointer = next;
      next += 4;
      live.add(pointer);
      return pointer;
    },
    free: (pointer) => {
      live.delete(pointer);
    },
    output: () => output,
    gate: (name, fn) => {
      gates.set(name, fn);
      return 0x4000;
    },
  });
  const call = (name: string, ...args: number[]): number | void => {
    const fn = runtime.funcs[name];
    if (!fn) throw new Error(`Missing ${name}`);
    return fn((index) => args[index] ?? 0);
  };
  const device = call("_alcOpenDevice", 0),
    context = call("_alcCreateContext", Number(device), 0);
  call("_alcMakeContextCurrent", Number(context));
  return {
    ...runtime,
    call,
    view,
    memory,
    calls,
    live,
    gates,
    device: Number(device),
    context: Number(context),
    time: (value: number) => {
      time = value;
    },
  };
}
test("OpenAL ABI controls real PCM queues, errors, gain and resource lifetimes", () => {
  const x = fixture();
  x.call("_alGenBuffers", 2, 512);
  const first = x.view.getUint32(512, true),
    second = x.view.getUint32(516, true);
  x.memory.fill(128, 2048, 10048);
  for (const name of [first, second])
    x.call("_alBufferData", name, PCMFormat.Mono8, 2048, 8000, 8000);
  x.call("_alGenSources", 1, 520);
  const source = x.view.getUint32(520, true);
  x.call("_alSourceQueueBuffers", source, 2, 512);
  x.call("_alSourcef", source, AL.Gain, floatBits(0.5));
  x.call("_alSourcePlay", source);
  expect(x.call("_alGetError")).toBe(0);
  expect(x.calls.map((call) => call.gain)).toEqual([0.5, 0.5]);
  x.call("_alDeleteBuffers", 1, 512);
  expect(x.call("_alGetError")).toBe(ALError.InvalidOperation);
  expect(x.call("_alGetError")).toBe(0);
  x.time(1.25);
  x.call("_alGetSourcei", source, AL.Processed, 528);
  expect(x.view.getUint32(528, true)).toBe(1);
  x.call("_alSourceUnqueueBuffers", source, 1, 532);
  expect(x.view.getUint32(532, true)).toBe(first);
  x.call("_alDeleteBuffers", 1, 512);
  expect(x.call("_alGetError")).toBe(0);
  x.close();
  expect(x.live.size).toBe(0);
  expect(x.calls.every((call) => call.stopped)).toBe(true);
});
test("unknown queued buffer names fail atomically and known AL functions resolve to guest gates", () => {
  const x = fixture();
  x.call("_alGenBuffers", 1, 512);
  x.call("_alGenSources", 1, 520);
  const source = x.view.getUint32(520, true);
  x.view.setUint32(516, 0xffffffff, true);
  x.call("_alSourceQueueBuffers", source, 2, 512);
  expect(x.call("_alGetError")).toBe(ALError.InvalidName);
  x.call("_alGetSourcei", source, AL.Queued, 528);
  expect(x.view.getUint32(528, true)).toBe(0);
  x.memory.set(new TextEncoder().encode("alBufferData\0"), 16000);
  expect(x.call("_alcGetProcAddress", x.device, 16000)).toBe(0x4000);
  expect(x.gates.has("_alBufferData")).toBe(true);
  expect(x.call("_alcCloseDevice", x.device)).toBe(0);
  x.call("_alcDestroyContext", x.context);
  expect(x.call("_alcCloseDevice", x.device)).toBe(1);
  expect(x.live.size).toBe(0);
});

test("Apple static PCM uploads resolve to real buffer conversion and retain standard errors", () => {
  const x = fixture();
  x.call("_alGenBuffers", 1, 512);
  const buffer = x.view.getUint32(512, true);
  x.memory.set(new TextEncoder().encode("alBufferDataStatic\0"), 16000);
  expect(x.call("_alcGetProcAddress", 0, 16000)).toBe(0x4000);
  const upload = x.gates.get("_alBufferDataStatic");
  if (!upload) throw new Error("Static buffer gate missing.");
  const args = [buffer, PCMFormat.Mono16, 2048, 16, 8000];
  for (let i = 0; i < 8; i++) x.view.setInt16(2048 + i * 2, 16384, true);
  upload((i) => args[i] ?? 0);
  expect(x.call("_alGetError")).toBe(0);
  x.call("_alGetBufferi", buffer, AL.Size, 528);
  expect(x.view.getUint32(528, true)).toBe(16);
  x.call("_alBufferDataStatic", buffer, PCMFormat.Mono16, 0, 16, 8000);
  expect(x.call("_alGetError")).toBe(ALError.InvalidValue);
  x.call("_alGenSources", 1, 520);
  const source = x.view.getUint32(520, true);
  x.call("_alSourcei", source, AL.Buffer, buffer);
  x.call("_alSourcePlay", source);
  expect(x.calls.length).toBe(1);
  x.call("_alBufferDataStatic", buffer, PCMFormat.Mono16, 2048, 16, 8000);
  expect(x.call("_alGetError")).toBe(ALError.InvalidOperation);
  x.close();
});
test("the listener keeps gain, position and orientation and rejects bad values", () => {
  const x = fixture();
  const floats = (pointer: number, values: number[]) =>
    values.forEach((value, index) => x.view.setFloat32(pointer + index * 4, value, true));
  floats(600, [1, 2, 3]);
  x.call("_alListenerfv", AL.Position, 600);
  x.call("_alListenerf", AL.Gain, floatBits(0.25));
  floats(700, [0, 0, 1, 0, 1, 0]);
  x.call("_alListenerfv", AL.Orientation, 700);
  x.call("_alGetListenerfv", AL.Orientation, 800);
  x.call("_alGetListener3f", AL.Position, 900, 904, 908);
  x.call("_alGetListenerf", AL.Gain, 912);
  const read = (pointer: number) => x.view.getFloat32(pointer, true);
  expect([800, 804, 808, 812, 816, 820].map(read)).toEqual([0, 0, 1, 0, 1, 0]);
  expect([900, 904, 908, 912].map(read)).toEqual([1, 2, 3, 0.25]);
  expect(x.call("_alGetError")).toBe(0);
  x.call("_alListenerf", AL.Gain, floatBits(-1));
  expect(x.call("_alGetError")).toBe(ALError.InvalidValue);
});
