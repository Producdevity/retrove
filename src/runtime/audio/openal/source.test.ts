import { expect, test } from "vite-plus/test";
import { AL, PCMFormat } from "./constants";
import { decodePCM } from "./pcm";
import { Source } from "./source";
import type { AudioOutput } from "./output";
function fixture() {
  let time = 0;
  const calls: {
    at: number;
    offset: number;
    duration: number;
    pitch: number;
    loop: boolean;
    stopped: boolean;
  }[] = [];
  const output: AudioOutput = {
    get time() {
      return time;
    },
    rate: 8000,
    play: (_pcm, at, offset, duration, properties, loop = false) => {
      const call = { at, offset, duration, pitch: properties.pitch, loop, stopped: false };
      calls.push(call);
      return {
        stop: () => {
          call.stopped = true;
        },
        gain: () => {},
      };
    },
  };
  const pcm = decodePCM(PCMFormat.Mono8, new Uint8Array(8000).fill(128), 8000),
    source = new Source(output);
  return {
    source,
    pcm,
    calls,
    time: (value: number) => {
      time = value;
    },
  };
}
test("source queues track partial playback, processed buffers, unqueue, pause and resume", () => {
  const x = fixture();
  x.source.append([
    { name: 1, pcm: x.pcm },
    { name: 2, pcm: x.pcm },
  ]);
  x.source.play();
  expect(x.calls.map((call) => call.at)).toEqual([0, 1]);
  x.time(1.25);
  expect(x.source.processed).toBe(1);
  expect(x.source.unqueue(1).map((buffer) => buffer.name)).toEqual([1]);
  expect(x.source.cursor).toBe(0.25);
  x.source.pause();
  x.time(3);
  expect(x.source.cursor).toBe(0.25);
  expect(x.source.state).toBe(AL.Paused);
  x.source.play();
  expect(x.calls.at(-1)?.offset).toBe(0.25);
  x.time(3.75);
  expect(x.source.processed).toBe(1);
  expect(x.source.state).toBe(AL.Stopped);
});
test("looping schedules a real looping voice and suspension freezes its clock without changing AL state", () => {
  const x = fixture();
  x.source.append([
    { name: 1, pcm: x.pcm },
    { name: 2, pcm: x.pcm },
  ]);
  x.source.looping = true;
  x.source.play();
  expect(x.calls.at(-1)?.loop).toBe(true);
  x.time(2.5);
  expect(x.source.cursor).toBe(0.5);
  expect(x.source.processed).toBe(0);
  x.source.suspend();
  x.time(10);
  expect(x.source.cursor).toBe(0.5);
  expect(x.source.state).toBe(AL.Playing);
  x.source.resume();
  expect(x.calls.at(-1)?.offset).toBe(0.5);
  x.source.pause();
  expect(x.source.state).toBe(AL.Paused);
});
test("pitch changes preserve position and stop makes queued buffers available without replay", () => {
  const x = fixture();
  x.source.append([
    { name: 1, pcm: x.pcm },
    { name: 2, pcm: x.pcm },
  ]);
  x.source.play();
  x.time(0.25);
  x.source.changePitch(2);
  x.time(0.5);
  expect(x.source.cursor).toBe(0.75);
  x.source.stop();
  expect(x.source.processed).toBe(2);
  expect(x.source.unqueue(2)).toHaveLength(2);
  expect(x.calls.every((call) => call.stopped)).toBe(true);
});

test("replacing a stopped looping queue invalidates the concatenated audio buffer", () => {
  const x = fixture();
  x.source.append([
    { name: 1, pcm: x.pcm },
    { name: 2, pcm: x.pcm },
  ]);
  x.source.looping = true;
  x.source.play();
  expect(x.calls.at(-1)?.duration).toBe(2);
  x.source.stop();
  x.source.bind({ name: 3, pcm: x.pcm });
  x.source.play();
  expect(x.calls.at(-1)?.duration).toBe(1);
});
