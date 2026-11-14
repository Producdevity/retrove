import type { PCM } from "./pcm";
import type { Vector3 } from "./constants";
const Z_AXIS = 2;
export interface VoiceProperties {
  readonly gain: number;
  readonly pitch: number;
  readonly position: Vector3;
  readonly direction: Vector3;
  readonly referenceDistance: number;
  readonly maxDistance: number;
  readonly rolloff: number;
  readonly coneInner: number;
  readonly coneOuter: number;
  readonly coneGain: number;
}
export interface Voice {
  stop(): void;
  gain(value: number): void;
}
export interface AudioOutput {
  readonly time: number;
  readonly rate: number;
  play(
    pcm: PCM,
    at: number,
    offset: number,
    duration: number,
    properties: VoiceProperties,
    loop?: boolean,
  ): Voice;
}
export class WebAudioOutput implements AudioOutput {
  private readonly buffers = new WeakMap<PCM, AudioBuffer>();
  constructor(private readonly context: BaseAudioContext) {}
  get time(): number {
    return this.context.currentTime;
  }
  get rate(): number {
    return this.context.sampleRate;
  }
  play(
    pcm: PCM,
    at: number,
    offset: number,
    duration: number,
    properties: VoiceProperties,
    loop = false,
  ): Voice {
    let buffer = this.buffers.get(pcm);
    if (!buffer) {
      buffer = this.context.createBuffer(pcm.channels.length, pcm.frames, pcm.rate);
      pcm.channels.forEach((channel, index) => buffer?.getChannelData(index).set(channel));
      this.buffers.set(pcm, buffer);
    }
    const node = this.context.createBufferSource(),
      gain = this.context.createGain();
    node.buffer = buffer;
    node.playbackRate.value = properties.pitch;
    gain.gain.value = properties.gain;
    let panner: PannerNode | undefined;
    if (pcm.channels.length === 1) {
      panner = this.context.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = properties.referenceDistance;
      panner.maxDistance = properties.maxDistance;
      panner.rolloffFactor = properties.rolloff;
      panner.coneInnerAngle = properties.coneInner;
      panner.coneOuterAngle = properties.coneOuter;
      panner.coneOuterGain = properties.coneGain;
      panner.positionX.value = properties.position[0];
      panner.positionY.value = properties.position[1];
      panner.positionZ.value = properties.position[Z_AXIS];
      panner.orientationX.value = properties.direction[0];
      panner.orientationY.value = properties.direction[1];
      panner.orientationZ.value = properties.direction[Z_AXIS];
      node.connect(panner);
      panner.connect(gain);
    } else node.connect(gain);
    gain.connect(this.context.destination);
    let stopped = false;
    const disconnect = (): void => {
      node.onended = null;
      node.disconnect();
      panner?.disconnect();
      gain.disconnect();
    };
    node.onended = disconnect;
    node.loop = loop;
    if (loop) node.start(at, offset);
    else node.start(at, offset, duration);
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        node.onended = null;
        node.stop();
        disconnect();
      },
      gain: (value) => {
        gain.gain.value = value;
      },
    };
  }
}
