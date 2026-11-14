export const ALError = {
  InvalidName: 0xa001,
  InvalidEnum: 0xa002,
  InvalidValue: 0xa003,
  InvalidOperation: 0xa004,
  OutOfMemory: 0xa005,
} as const;
export const ALCError = {
  InvalidDevice: 0xa001,
  InvalidContext: 0xa002,
  InvalidEnum: 0xa003,
  InvalidValue: 0xa004,
  OutOfMemory: 0xa005,
} as const;
export const AL = {
  Relative: 0x0202,
  ConeInnerAngle: 0x1001,
  ConeOuterAngle: 0x1002,
  Pitch: 0x1003,
  Position: 0x1004,
  Direction: 0x1005,
  Velocity: 0x1006,
  Looping: 0x1007,
  Buffer: 0x1009,
  Gain: 0x100a,
  MinGain: 0x100d,
  MaxGain: 0x100e,
  Orientation: 0x100f,
  State: 0x1010,
  Initial: 0x1011,
  Playing: 0x1012,
  Paused: 0x1013,
  Stopped: 0x1014,
  Queued: 0x1015,
  Processed: 0x1016,
  ReferenceDistance: 0x1020,
  RolloffFactor: 0x1021,
  ConeOuterGain: 0x1022,
  MaxDistance: 0x1023,
  SecondsOffset: 0x1024,
  SamplesOffset: 0x1025,
  BytesOffset: 0x1026,
  Type: 0x1027,
  Static: 0x1028,
  Streaming: 0x1029,
  Undetermined: 0x1030,
  Frequency: 0x2001,
  Bits: 0x2002,
  Channels: 0x2003,
  Size: 0x2004,
  Vendor: 0xb001,
  Version: 0xb002,
  Renderer: 0xb003,
  Extensions: 0xb004,
} as const;
export const ALC = {
  Frequency: 0x1007,
  Refresh: 0x1008,
  Sync: 0x1009,
  MajorVersion: 0x1000,
  MinorVersion: 0x1001,
  AttributesSize: 0x1002,
  AllAttributes: 0x1003,
  DefaultDevice: 0x1004,
  Device: 0x1005,
  Extensions: 0x1006,
  MonoSources: 0x1010,
  StereoSources: 0x1011,
} as const;
export const PCMFormat = {
  Mono8: 0x1100,
  Mono16: 0x1101,
  Stereo8: 0x1102,
  Stereo16: 0x1103,
} as const;
export const MAX_NAMES_PER_CALL = 65_536;
export const MAX_SOURCES = 256;
export const MAX_BUFFER_BYTES = 67_108_864;
export const FULL_CIRCLE_DEGREES = 360;
export const DEFAULT_MAX_DISTANCE = 3.402823466e38;
export type Vector3 = readonly [number, number, number];
export class OpenALError extends Error {
  constructor(readonly code: number) {
    super(`OpenAL error ${code}`);
  }
}
