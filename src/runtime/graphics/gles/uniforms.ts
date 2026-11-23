import { WORD_BYTES } from "../../ios/abi/scalars";
import { readString } from "../../memory/guest-memory";
import type { GraphicsContext } from "../gl-parameters";
import { float, signed, words2, words3, words4, words5 } from "./arguments";
import type { GlesContext } from "./context";
import { sourceBuffer, type ViewType } from "./data";

const NULL_LOCATION = 0xffffffff;
const Dimension = { Two: 2, Three: 3, Four: 4 } as const;
type Location = WebGLUniformLocation | null;
type VectorCall<T> = (gl: GraphicsContext, location: Location, data: T) => void;
type MatrixCall = (
  gl: GraphicsContext,
  location: Location,
  transpose: boolean,
  data: Float32Array,
) => void;

const FLOAT_VECTORS: readonly VectorCall<Float32Array>[] = [
  (gl, location, data) => gl.uniform1fv(location, data),
  (gl, location, data) => gl.uniform2fv(location, data),
  (gl, location, data) => gl.uniform3fv(location, data),
  (gl, location, data) => gl.uniform4fv(location, data),
];
const INTEGER_VECTORS: readonly VectorCall<Int32Array>[] = [
  (gl, location, data) => gl.uniform1iv(location, data),
  (gl, location, data) => gl.uniform2iv(location, data),
  (gl, location, data) => gl.uniform3iv(location, data),
  (gl, location, data) => gl.uniform4iv(location, data),
];
const MATRICES: readonly (readonly [number, MatrixCall])[] = [
  [
    Dimension.Two,
    (gl, location, transpose, data) => gl.uniformMatrix2fv(location, transpose, data),
  ],
  [
    Dimension.Three,
    (gl, location, transpose, data) => gl.uniformMatrix3fv(location, transpose, data),
  ],
  [
    Dimension.Four,
    (gl, location, transpose, data) => gl.uniformMatrix4fv(location, transpose, data),
  ],
];

function installVectors<T>(
  host: GlesContext,
  locate: (number: number) => Location,
  suffix: string,
  calls: readonly VectorCall<T>[],
  Type: ViewType<T>,
): void {
  calls.forEach((call, index) => {
    const components = index + 1;
    host.bind(`Uniform${components}${suffix}v`, (a) => {
      const [number, count, pointer] = words3(a);
      call(
        host.gl(),
        locate(number),
        sourceBuffer(host.cpu, pointer, count * components * WORD_BYTES, Type),
      );
    });
  });
}

/** Uniform locations are small guest integers that map to the driver's opaque handles. */
export function installUniforms(host: GlesContext): void {
  const locations = new Map<number, WebGLUniformLocation>();
  let next = 0;
  const locate = (number: number): Location => {
    if (number === NULL_LOCATION || number === -1) return null;
    const location = locations.get(number);
    if (!location) throw new Error("Unknown GLES uniform location " + number);
    return location;
  };
  host.bind("GetUniformLocation", (a) => {
    const [program, name] = words2(a);
    const object = host.handles.getProgram(program);
    if (!object) throw new Error(`Invalid GLES object ${program}`);
    const location = host.gl().getUniformLocation(object, readString(host.cpu, name));
    if (location === null) return -1;
    const number = next++;
    locations.set(number, location);
    return number;
  });
  host.bind("Uniform1f", (a) => {
    const [number, x] = words2(a);
    host.gl().uniform1f(locate(number), float(x));
  });
  host.bind("Uniform2f", (a) => {
    const [number, x, y] = words3(a);
    host.gl().uniform2f(locate(number), float(x), float(y));
  });
  host.bind("Uniform3f", (a) => {
    const [number, x, y, z] = words4(a);
    host.gl().uniform3f(locate(number), float(x), float(y), float(z));
  });
  host.bind("Uniform4f", (a) => {
    const [number, x, y, z, w] = words5(a);
    host.gl().uniform4f(locate(number), float(x), float(y), float(z), float(w));
  });
  host.bind("Uniform1i", (a) => {
    const [number, x] = words2(a);
    host.gl().uniform1i(locate(number), signed(x));
  });
  host.bind("Uniform2i", (a) => {
    const [number, x, y] = words3(a);
    host.gl().uniform2i(locate(number), signed(x), signed(y));
  });
  host.bind("Uniform3i", (a) => {
    const [number, x, y, z] = words4(a);
    host.gl().uniform3i(locate(number), signed(x), signed(y), signed(z));
  });
  host.bind("Uniform4i", (a) => {
    const [number, x, y, z, w] = words5(a);
    host.gl().uniform4i(locate(number), signed(x), signed(y), signed(z), signed(w));
  });
  installVectors(host, locate, "f", FLOAT_VECTORS, Float32Array);
  installVectors(host, locate, "i", INTEGER_VECTORS, Int32Array);
  for (const [size, call] of MATRICES)
    host.bind(`UniformMatrix${size}fv`, (a) => {
      const [number, count, transpose, pointer] = words4(a);
      call(
        host.gl(),
        locate(number),
        Boolean(transpose),
        sourceBuffer(host.cpu, pointer, count * size * size * WORD_BYTES, Float32Array),
      );
    });
}
