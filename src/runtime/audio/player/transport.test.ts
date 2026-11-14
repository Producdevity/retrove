import { expect, test } from "vite-plus/test";
import { PlayerTransport } from "./transport";
import type { PlayerOutput } from "./output";
function fixture() {
  const samples = new Float32Array(8000);
  const buffer: AudioBuffer = {
    duration: 1,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate: 8000,
    getChannelData: () => samples,
    copyFromChannel: (destination) => {
      destination.set(samples.subarray(0, destination.length));
    },
    copyToChannel: (source) => {
      samples.set(source);
    },
  };
  const calls: {
    when: number;
    offset: number;
    seconds: number;
    rate: number;
    volume: number;
    pan: number;
    stopped: boolean;
    ended: () => void;
  }[] = [];
  const output: PlayerOutput & { time: number; ready: boolean } = {
    time: 10,
    ready: true,
    play: (_buffer, when, offset, seconds, rate, volume, pan, ended) => {
      const call = { when, offset, seconds, rate, volume, pan, ended, stopped: false };
      calls.push(call);
      return {
        stop: () => {
          call.stopped = true;
        },
        volume: (value) => {
          call.volume = value;
        },
        pan: (value) => {
          call.pan = value;
        },
      };
    },
  };
  return { player: new PlayerTransport(buffer, output), output, calls };
}
test("player preserves playback positions through pause, stop, seeking and scheduling", () => {
  const { player, output, calls } = fixture();
  expect(player.play()).toBe(true);
  expect(player.play()).toBe(true);
  expect(calls.length).toBe(1);
  output.time = 10.25;
  expect(player.currentTime).toBe(0.25);
  player.pause();
  expect(calls[0]?.stopped).toBe(true);
  output.time = 11;
  expect(player.currentTime).toBe(0.25);
  player.play(12);
  expect(calls[1]?.when).toBe(12);
  expect(player.currentTime).toBe(0.25);
  output.time = 12.125;
  player.seek(0.5);
  expect(calls[2]?.offset).toBe(0.5);
  output.time = 12.375;
  expect(player.currentTime).toBe(0.75);
  player.stop();
  expect(player.currentTime).toBe(0.75);
  expect(player.playing).toBe(false);
  expect(player.takeCompletion()).toBe(false);
  player.seek(50);
  player.play();
  expect(calls.at(-1)?.offset).toBe(0);
});
test("player finite loops remain bounded across pause and infinite loops have no scheduled end", () => {
  const { player, output, calls } = fixture();
  player.numberOfLoops = 2;
  player.seek(0.25);
  player.play();
  expect(calls[0]?.seconds).toBe(2.75);
  output.time = 11.5;
  player.pause();
  expect(player.currentTime).toBe(0.75);
  player.play();
  expect(calls[1]?.seconds).toBe(1.25);
  player.numberOfLoops = -2;
  expect(calls.at(-1)?.seconds).toBe(Infinity);
  player.volume = 0.3;
  player.pan = -0.5;
  expect(calls.at(-1)?.volume).toBe(0.3);
  expect(calls.at(-1)?.pan).toBe(-0.5);
  player.stop();
});
test("player applies enabled playback rates and queues exactly one completion", () => {
  const { player, output, calls } = fixture();
  player.rate = 2;
  player.play();
  expect(calls[0]?.rate).toBe(1);
  output.time = 10.25;
  player.enableRate = true;
  expect(calls[1]?.offset).toBe(0.25);
  expect(calls[1]?.rate).toBe(2);
  output.time = 10.5;
  expect(player.currentTime).toBe(0.75);
  calls[1]?.ended();
  expect(player.playing).toBe(false);
  expect(player.currentTime).toBe(0);
  expect(player.completionPending).toBe(true);
  expect(player.takeCompletion()).toBe(true);
  expect(player.takeCompletion()).toBe(false);
  output.ready = false;
  expect(player.prepare()).toBe(false);
  expect(player.play()).toBe(false);
});
