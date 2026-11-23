import { WORD_BYTES } from "../../ios/abi/scalars";
import { hasBlit } from "../gl-parameters";
import { float, signed, words2, words3, words4, words5, words6 } from "./arguments";
import { Gles } from "./constants";
import type { GlesContext } from "./context";
import { sourceBuffer, sourceBytes } from "./data";

const HEX_RADIX = 16;
const Size = { Byte: 1, Short: 2, Word: 4 } as const;
const TYPE_BYTES = new Map<number, number>([
  [Gles.Byte, Size.Byte],
  [Gles.UnsignedByte, Size.Byte],
  [Gles.Short, Size.Short],
  [Gles.UnsignedShort, Size.Short],
  [Gles.UnsignedInt, Size.Word],
  [Gles.Float, Size.Word],
]);

interface ClientArray {
  readonly size: number;
  readonly type: number;
  readonly normalized: boolean;
  readonly stride: number;
  readonly pointer: number;
  staging: WebGLBuffer | null | undefined;
}

function indexWidth(host: GlesContext, type: number): number {
  if (type === Gles.UnsignedByte) return Size.Byte;
  if (type === Gles.UnsignedShort) return Size.Short;
  const gl = host.gl();
  return type === Gles.UnsignedInt && (hasBlit(gl) || gl.getExtension("OES_element_index_uint"))
    ? Size.Word
    : 0;
}

function maxIndex(indices: Uint8Array, width: number, count: number): number {
  const view = new DataView(indices.buffer, indices.byteOffset, indices.byteLength);
  let max = 0;
  for (let index = 0; index < count; index++) {
    const value =
      width === Size.Byte
        ? (indices[index] ?? 0)
        : width === Size.Short
          ? view.getUint16(index * Size.Short, true)
          : view.getUint32(index * Size.Word, true);
    if (value > max) max = value;
  }
  return max;
}

function installAttributeValues(host: GlesContext): void {
  host.bind("VertexAttrib1f", (a) => {
    const [index, x] = words2(a);
    host.gl().vertexAttrib1f(index, float(x));
  });
  host.bind("VertexAttrib2f", (a) => {
    const [index, x, y] = words3(a);
    host.gl().vertexAttrib2f(index, float(x), float(y));
  });
  host.bind("VertexAttrib3f", (a) => {
    const [index, x, y, z] = words4(a);
    host.gl().vertexAttrib3f(index, float(x), float(y), float(z));
  });
  host.bind("VertexAttrib4f", (a) => {
    const [index, x, y, z, w] = words5(a);
    host.gl().vertexAttrib4f(index, float(x), float(y), float(z), float(w));
  });
  const vector = (a: (n: number) => number, components: number) =>
    sourceBuffer(host.cpu, a(1), components * WORD_BYTES, Float32Array);
  host.bind("VertexAttrib1fv", (a) => host.gl().vertexAttrib1fv(a(0), vector(a, 1)));
  host.bind("VertexAttrib2fv", (a) => host.gl().vertexAttrib2fv(a(0), vector(a, Size.Short)));
  host.bind("VertexAttrib3fv", (a) => host.gl().vertexAttrib3fv(a(0), vector(a, Size.Short + 1)));
  host.bind("VertexAttrib4fv", (a) => host.gl().vertexAttrib4fv(a(0), vector(a, Size.Word)));
}

interface VertexState {
  readonly clientArrays: Map<number, ClientArray>;
  readonly enabled: Set<number>;
  indexStaging: WebGLBuffer | null | undefined;
}

function installArrays(host: GlesContext, state: VertexState): void {
  const { clientArrays, enabled } = state;
  host.bind("EnableVertexAttribArray", (a) => {
    host.gl().enableVertexAttribArray(a(0));
    enabled.add(a(0));
  });
  host.bind("DisableVertexAttribArray", (a) => {
    host.gl().disableVertexAttribArray(a(0));
    enabled.delete(a(0));
  });
  host.bind("VertexAttribPointer", (a) => {
    const [index, size, guestType, normalized, stride, pointer] = words6(a);
    const type = guestType === Gles.HalfFloatOes && hasBlit(host.gl()) ? Gles.HalfFloat : guestType;
    if (host.array) {
      const old = clientArrays.get(index);
      if (old?.staging) host.gl().deleteBuffer(old.staging);
      clientArrays.delete(index);
      host.gl().vertexAttribPointer(index, size, type, Boolean(normalized), stride, pointer);
    } else {
      clientArrays.set(index, {
        size,
        type,
        normalized: Boolean(normalized),
        stride,
        pointer,
        staging: clientArrays.get(index)?.staging,
      });
    }
  });
}

function stageAttributes(host: GlesContext, state: VertexState, lastIndex: number): void {
  if (lastIndex < 0) return;
  const gl = host.gl();
  for (const [index, attribute] of state.clientArrays) {
    if (!state.enabled.has(index)) continue;
    const unit = attribute.type === Gles.HalfFloat ? Size.Short : TYPE_BYTES.get(attribute.type);
    const width = (unit ?? 0) * attribute.size;
    if (!width)
      throw new Error("Unsupported GLES vertex type 0x" + attribute.type.toString(HEX_RADIX));
    const length = (attribute.stride || width) * lastIndex + width;
    attribute.staging ??= gl.createBuffer();
    gl.bindBuffer(Gles.ArrayBuffer, attribute.staging);
    gl.bufferData(
      Gles.ArrayBuffer,
      sourceBytes(host.cpu, attribute.pointer, length),
      Gles.StaticDraw,
    );
    gl.vertexAttribPointer(
      index,
      attribute.size,
      attribute.type,
      attribute.normalized,
      attribute.stride,
      0,
    );
  }
  gl.bindBuffer(Gles.ArrayBuffer, host.handles.getBuffer(host.array));
}

function elementIndices(
  host: GlesContext,
  state: VertexState,
  pointer: number,
  count: number,
  width: number,
  live: boolean,
): Uint8Array | undefined {
  if (!host.elements) {
    const indices = sourceBytes(host.cpu, pointer, count * width);
    state.indexStaging ??= host.gl().createBuffer();
    host.gl().bindBuffer(Gles.ElementArrayBuffer, state.indexStaging);
    host.gl().bufferData(Gles.ElementArrayBuffer, indices, Gles.StaticDraw);
    return indices;
  }
  if (!live) return undefined;
  const backing = host.bufferData.get(host.elements);
  if (backing && !backing.bytes) backing.bytes = new Uint8Array(backing.size);
  const bytes = backing?.bytes;
  if (!bytes || pointer + count * width > bytes.length)
    throw new Error("GLES element buffer data unavailable for client vertex arrays");
  return bytes.subarray(pointer, pointer + count * width);
}

function installDraws(host: GlesContext, state: VertexState): void {
  host.bind("DrawArrays", (a) => {
    host.flagDriverCheck();
    const [mode, first, count] = words3(a);
    if (state.clientArrays.size && count)
      stageAttributes(host, state, signed(first) + signed(count) - 1);
    host.gl().drawArrays(mode, signed(first), signed(count));
  });
  const drawElements = (a: (n: number) => number): void => {
    host.flagDriverCheck();
    const [mode, count, type, pointer] = words4(a);
    const width = indexWidth(host, type);
    if (!width) throw new Error("Unsupported GLES index type 0x" + type.toString(HEX_RADIX));
    const live = [...state.clientArrays.keys()].some((index) => state.enabled.has(index));
    const indices = elementIndices(host, state, pointer, count, width, live);
    if (live && count && indices) stageAttributes(host, state, maxIndex(indices, width, count));
    host.gl().drawElements(mode, count, type, host.elements ? pointer : 0);
    if (!host.elements) host.gl().bindBuffer(Gles.ElementArrayBuffer, null);
  };
  host.bind("DrawElements", drawElements);
  host.bind("DrawRangeElements", (a) => {
    const [mode, , , count, type, pointer] = words6(a);
    drawElements((index) => [mode, count, type, pointer][index] ?? 0);
  });
  host.bind("DiscardFramebufferEXT", () => {});
}

/** Vertex arrays, with client-memory arrays staged into driver buffers when a draw reads them. */
export function installVertex(host: GlesContext): void {
  const state: VertexState = {
    clientArrays: new Map(),
    enabled: new Set(),
    indexStaging: undefined,
  };
  installAttributeValues(host);
  installArrays(host, state);
  installDraws(host, state);
}
