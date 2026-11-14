import { AL, ALError, FULL_CIRCLE_DEGREES, OpenALError, type Vector3 } from "./constants";
import type { Source } from "./source";
import type { OpenALRuntime } from "./runtime";
type ScalarField =
  | "gain"
  | "pitch"
  | "minGain"
  | "maxGain"
  | "referenceDistance"
  | "maxDistance"
  | "rolloff"
  | "coneInner"
  | "coneOuter"
  | "coneGain";
const ScalarProperties = new Map<number, ScalarField>([
  [AL.Gain, "gain"],
  [AL.Pitch, "pitch"],
  [AL.MinGain, "minGain"],
  [AL.MaxGain, "maxGain"],
  [AL.ReferenceDistance, "referenceDistance"],
  [AL.MaxDistance, "maxDistance"],
  [AL.RolloffFactor, "rolloff"],
  [AL.ConeInnerAngle, "coneInner"],
  [AL.ConeOuterAngle, "coneOuter"],
  [AL.ConeOuterGain, "coneGain"],
] as const);
export function sourceValue(source: Source, name: number): number {
  const offset = source.cursor;
  const field = ScalarProperties.get(name);
  if (field) return source[field];
  const pcm = source.queue[0]?.pcm;
  switch (name) {
    case AL.Buffer:
      return source.kind === AL.Static ? (source.queue[0]?.name ?? 0) : 0;
    case AL.State:
      return source.state;
    case AL.Type:
      return source.kind;
    case AL.Looping:
      return Number(source.looping);
    case AL.Relative:
      return Number(source.relative);
    case AL.Queued:
      return source.queue.length;
    case AL.Processed:
      return source.processed;
    case AL.SecondsOffset:
      return source.state === AL.Stopped ? 0 : offset;
    case AL.SamplesOffset:
      return source.state === AL.Stopped ? 0 : offset * (pcm?.rate ?? 0);
    case AL.BytesOffset:
      return source.state === AL.Stopped
        ? 0
        : offset * (pcm?.rate ?? 0) * (pcm?.channels.length ?? 0) * (pcm?.sampleBytes ?? 0);
    default:
      throw new OpenALError(ALError.InvalidEnum);
  }
}
export function setScalar(source: Source, name: number, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new OpenALError(ALError.InvalidValue);
  if (name === AL.SecondsOffset || name === AL.SamplesOffset || name === AL.BytesOffset) {
    const pcm = source.queue[0]?.pcm;
    const divisor =
      name === AL.SecondsOffset
        ? 1
        : (pcm?.rate ?? 0) *
          (name === AL.BytesOffset ? (pcm?.channels.length ?? 0) * (pcm?.sampleBytes ?? 0) : 1);
    if (!divisor) throw new OpenALError(ALError.InvalidValue);
    source.seek(value / divisor);
    return;
  }
  const field = ScalarProperties.get(name);
  if (!field) throw new OpenALError(ALError.InvalidEnum);
  if (
    (field === "pitch" && value === 0) ||
    ((field === "minGain" || field === "maxGain" || field === "coneGain") && value > 1) ||
    ((field === "coneInner" || field === "coneOuter") && value > FULL_CIRCLE_DEGREES)
  )
    throw new OpenALError(ALError.InvalidValue);
  if (field === "pitch") {
    source.changePitch(value);
    return;
  }
  source[field] = value;
  if (field === "gain" || field === "minGain" || field === "maxGain")
    for (const voice of source.voices) voice.gain(source.properties().gain);
  else source.reschedule();
}
export function setInteger(
  runtime: OpenALRuntime,
  source: Source,
  name: number,
  value: number,
): void {
  if (name === AL.Buffer) {
    const pcm = value ? runtime.buffer(value) : undefined;
    source.bind(pcm ? { name: value, pcm } : undefined);
    return;
  }
  if (name === AL.Looping || name === AL.Relative) {
    if (value !== 0 && value !== 1) throw new OpenALError(ALError.InvalidValue);
    if (name === AL.Looping) source.looping = Boolean(value);
    else source.relative = Boolean(value);
    source.reschedule();
    return;
  }
  setScalar(source, name, value);
}
export function setVector(source: Source, name: number, value: Vector3): void {
  if (value.some((component) => !Number.isFinite(component)))
    throw new OpenALError(ALError.InvalidValue);
  switch (name) {
    case AL.Position:
      source.position = value;
      break;
    case AL.Direction:
      source.direction = value;
      break;
    case AL.Velocity:
      source.velocity = value;
      break;
    default:
      throw new OpenALError(ALError.InvalidEnum);
  }
  source.reschedule();
}
