import { WORD_BYTES } from "../../ios/abi/scalars";
import { readString, write32 } from "../../memory/guest-memory";
import type { GraphicsContext } from "../gl-parameters";
import { words3, words4, words7 } from "./arguments";
import { Gles } from "./constants";
import type { GlesContext } from "./context";
import { writeString } from "./data";
import { HandleKind } from "./handles";
import { installShaderSource } from "./shader-source";

const MAX_WARNINGS = 12;
const LOG_LIMIT = 2048;
const EMPTY_LOG = "The driver returned an empty log.";

function present<T>(object: T | null, handle: number): T {
  if (object === null) throw new Error(`Invalid GLES object ${handle}`);
  return object;
}
/** The longest active uniform or attribute name, plus its terminator. */
function longestName(gl: GraphicsContext, program: WebGLProgram, uniforms: boolean): number {
  const total = Number(
    gl.getProgramParameter(program, uniforms ? Gles.ActiveUniforms : Gles.ActiveAttributes),
  );
  let longest = 0;
  for (let index = 0; index < total; index++) {
    const info = uniforms
      ? gl.getActiveUniform(program, index)
      : gl.getActiveAttrib(program, index);
    if (info) longest = Math.max(longest, info.name.length + 1);
  }
  return longest;
}

function installCompilation(host: GlesContext): void {
  host.bind("CreateShader", (a) => host.handles.shader(host.gl().createShader(a(0))));
  host.bind("CreateProgram", () => host.handles.program(host.gl().createProgram()));
  const shader = (handle: number) => present(host.handles.getShader(handle), handle);
  const program = (handle: number) => present(host.handles.getProgram(handle), handle);
  host.bind("CompileShader", (a) => host.gl().compileShader(shader(a(0))));
  host.bind("DeleteShader", (a) => host.gl().deleteShader(host.handles.getShader(a(0))));
  host.bind("LinkProgram", (a) => host.gl().linkProgram(program(a(0))));
  host.bind("UseProgram", (a) => host.gl().useProgram(host.handles.getProgram(a(0))));
  host.bind("DeleteProgram", (a) => host.gl().deleteProgram(host.handles.getProgram(a(0))));
  host.bind("ValidateProgram", (a) => host.gl().validateProgram(program(a(0))));
  host.bind("IsShader", (a) =>
    Number(
      host.handles.is(a(0), HandleKind.Shader) && host.gl().isShader(host.handles.getShader(a(0))),
    ),
  );
  host.bind("IsProgram", (a) =>
    Number(
      host.handles.is(a(0), HandleKind.Program) &&
        host.gl().isProgram(host.handles.getProgram(a(0))),
    ),
  );
  host.bind("AttachShader", (a) => host.gl().attachShader(program(a(0)), shader(a(1))));
  host.bind("DetachShader", (a) => host.gl().detachShader(program(a(0)), shader(a(1))));
  host.bind("BindAttribLocation", (a) => {
    const [handle, index, name] = words3(a);
    host.gl().bindAttribLocation(program(handle), index, readString(host.cpu, name));
  });
  host.bind("GetAttachedShaders", (a) => {
    const [handle, capacity, count, pointer] = words4(a);
    const attached = (host.gl().getAttachedShaders(program(handle)) || []).slice(0, capacity);
    if (count) write32(host.cpu, count, attached.length);
    attached.forEach((attachedShader, index) =>
      write32(host.cpu, pointer + WORD_BYTES * index, host.handles.shader(attachedShader)),
    );
  });
  host.bind("GetAttribLocation", (a) =>
    host.gl().getAttribLocation(program(a(0)), readString(host.cpu, a(1))),
  );
  installShaderSource(host, shader);
}

function warnOnFailure(
  host: GlesContext,
  warnings: Set<string>,
  event: string,
  handle: number,
  infoLog: string | null,
): void {
  const log = infoLog || EMPTY_LOG;
  if (warnings.has(event + log)) return;
  warnings.add(event + log);
  host.diagnostic?.("warn", "graphics", event, { handle, log: log.slice(0, LOG_LIMIT) });
}

function installProgramQueries(host: GlesContext): void {
  const warnings = new Set<string>();
  const failed = (value: unknown) =>
    Boolean(host.diagnostic) && !value && warnings.size < MAX_WARNINGS;
  host.bind("GetShaderiv", (a) => {
    const [handle, name, out] = words3(a);
    const gl = host.gl(),
      target = present(host.handles.getShader(handle), handle);
    let value: unknown;
    if (name === Gles.InfoLogLength) value = (gl.getShaderInfoLog(target) || "").length + 1;
    else if (name === Gles.ShaderSourceLength)
      value = (gl.getShaderSource(target) || "").length + 1;
    else value = gl.getShaderParameter(target, name);
    if (name === Gles.CompileStatus && failed(value))
      warnOnFailure(
        host,
        warnings,
        "Guest shader compilation failed",
        handle,
        gl.getShaderInfoLog(target),
      );
    write32(host.cpu, out, Number(value));
  });
  host.bind("GetProgramiv", (a) => {
    const [handle, name, out] = words3(a);
    const gl = host.gl(),
      target = present(host.handles.getProgram(handle), handle);
    let value: unknown;
    if (name === Gles.InfoLogLength) value = (gl.getProgramInfoLog(target) || "").length + 1;
    else if (name === Gles.ActiveUniformMaxLength || name === Gles.ActiveAttributeMaxLength)
      value = longestName(gl, target, name === Gles.ActiveUniformMaxLength);
    else value = gl.getProgramParameter(target, name);
    if (name === Gles.LinkStatus && failed(value))
      warnOnFailure(
        host,
        warnings,
        "Guest program link failed",
        handle,
        gl.getProgramInfoLog(target),
      );
    write32(host.cpu, out, Number(value));
  });
  host.bind("GetShaderInfoLog", (a) => {
    const [handle, capacity, length, destination] = words4(a);
    const log = host.gl().getShaderInfoLog(present(host.handles.getShader(handle), handle));
    writeString(host.cpu, log, capacity, length, destination);
  });
  host.bind("GetProgramInfoLog", (a) => {
    const [handle, capacity, length, destination] = words4(a);
    const log = host.gl().getProgramInfoLog(present(host.handles.getProgram(handle), handle));
    writeString(host.cpu, log, capacity, length, destination);
  });
  for (const [name, uniforms] of [
    ["GetActiveAttrib", false],
    ["GetActiveUniform", true],
  ] as const)
    host.bind(name, (a) => {
      const [handle, index, capacity, length, size, type, destination] = words7(a);
      const target = present(host.handles.getProgram(handle), handle);
      const info = uniforms
        ? host.gl().getActiveUniform(target, index)
        : host.gl().getActiveAttrib(target, index);
      if (!info) return;
      if (size) write32(host.cpu, size, info.size);
      if (type) write32(host.cpu, type, info.type);
      writeString(host.cpu, info.name, capacity, length, destination);
    });
}

export function installPrograms(host: GlesContext): void {
  installCompilation(host);
  installProgramQueries(host);
}
