export interface PlayerVoice {
  stop(): void;
  volume(value: number): void;
  pan(value: number): void;
}
export interface PlayerOutput {
  readonly time: number;
  readonly ready: boolean;
  play(
    buffer: AudioBuffer,
    when: number,
    offset: number,
    seconds: number,
    rate: number,
    volume: number,
    pan: number,
    ended: () => void,
  ): PlayerVoice;
}
export class WebPlayerOutput implements PlayerOutput {
  constructor(private readonly context: BaseAudioContext) {}
  get time(): number {
    return this.context.currentTime;
  }
  get ready(): boolean {
    return this.context.state !== "closed";
  }
  play(
    buffer: AudioBuffer,
    when: number,
    offset: number,
    seconds: number,
    rate: number,
    volume: number,
    pan: number,
    ended: () => void,
  ): PlayerVoice {
    const source = this.context.createBufferSource(),
      gain = this.context.createGain(),
      panner = this.context.createStereoPanner();
    source.buffer = buffer;
    source.loop = seconds > buffer.duration - offset;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    panner.pan.value = pan;
    source.connect(panner);
    panner.connect(gain);
    gain.connect(this.context.destination);
    let stopped = false;
    const disconnect = (): void => {
      source.onended = null;
      source.disconnect();
      panner.disconnect();
      gain.disconnect();
    };
    source.onended = () => {
      stopped = true;
      disconnect();
      ended();
    };
    source.start(when, offset);
    if (Number.isFinite(seconds)) source.stop(when + seconds / rate);
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        source.onended = null;
        source.stop();
        disconnect();
      },
      volume: (value) => {
        gain.gain.value = value;
      },
      pan: (value) => {
        panner.pan.value = value;
      },
    };
  }
}
