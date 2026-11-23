import { WORD_BYTES } from "../../ios/abi/scalars";
import { read32, write32 } from "../../memory/guest-memory";
import type { GpuMemory } from "../gpu-memory";
import type { GraphicsContext } from "../gl-parameters";
import { words2, signed } from "./arguments";
import { Gles } from "./constants";
import type { GlesContext } from "./context";
import { HandleKind } from "./handles";

interface ObjectSpec<T extends object> {
  readonly kind: HandleKind;
  readonly accounting?: GpuMemory;
  create(gl: GraphicsContext): T | null;
  register(host: GlesContext, object: T | null): number;
  lookup(host: GlesContext, handle: number): T | null;
  destroy(gl: GraphicsContext, object: T): void;
  attach(gl: GraphicsContext, target: number, object: T | null): void;
  exists(gl: GraphicsContext, object: T | null): boolean;
  /** Runs after the guest deleted the object's name. */
  deleted?(host: GlesContext, handle: number): void;
  /** Runs after the guest bound `handle` to `target`. */
  bound?(host: GlesContext, target: number, handle: number): void;
}

function install<T extends object>(host: GlesContext, spec: ObjectSpec<T>): void {
  const { kind } = spec;
  host.bind(`Gen${kind}s`, (a) => {
    const [count, pointer] = words2(a);
    for (let index = 0; index < signed(count); index++)
      write32(host.cpu, pointer + index * WORD_BYTES, spec.register(host, spec.create(host.gl())));
  });
  host.bind(`Delete${kind}s`, (a) => {
    const [count, pointer] = words2(a);
    for (let index = 0; index < signed(count); index++) {
      const handle = read32(host.cpu, pointer + index * WORD_BYTES);
      if (!host.handles.is(handle, kind)) continue;
      const object = spec.lookup(host, handle);
      if (object) spec.destroy(host.gl(), object);
      host.handles.remove(handle);
      spec.accounting?.drop(handle);
      spec.deleted?.(host, handle);
    }
    if (kind === HandleKind.Buffer || kind === HandleKind.Texture) host.shadow?.forget();
  });
  host.bind(`Bind${kind}`, (a) => {
    const [target, handle] = words2(a);
    spec.attach(host.gl(), target, spec.lookup(host, handle));
    spec.bound?.(host, target, handle);
  });
  host.bind(`Is${kind}`, (a) =>
    Number(host.handles.is(a(0), kind) && spec.exists(host.gl(), spec.lookup(host, a(0)))),
  );
}

function deleteBuffer(host: GlesContext, handle: number): void {
  host.releaseMapping(host.bufferData.get(handle));
  host.bufferData.delete(handle);
  host.mapped.delete(handle);
  if (host.array === handle) host.array = 0;
  if (host.elements === handle) host.elements = 0;
}

/** Name creation, deletion, binding and queries for buffers, textures and framebuffers. */
export function installObjects(host: GlesContext): void {
  install<WebGLBuffer>(host, {
    kind: HandleKind.Buffer,
    accounting: host.memory.Buffer,
    create: (gl) => gl.createBuffer(),
    register: (state, object) => state.handles.buffer(object),
    lookup: (state, handle) => state.handles.getBuffer(handle),
    destroy: (gl, object) => gl.deleteBuffer(object),
    attach: (gl, target, object) => gl.bindBuffer(target, object),
    exists: (gl, object) => gl.isBuffer(object),
    deleted: deleteBuffer,
    bound: (state, target, handle) => {
      if (target === Gles.ArrayBuffer) state.array = handle;
      if (target === Gles.ElementArrayBuffer) state.elements = handle;
      state.shadowed((shadow) => shadow.buffer(target, handle));
    },
  });
  install<WebGLTexture>(host, {
    kind: HandleKind.Texture,
    accounting: host.memory.Texture,
    create: (gl) => gl.createTexture(),
    register: (state, object) => state.handles.texture(object),
    lookup: (state, handle) => state.handles.getTexture(handle),
    destroy: (gl, object) => gl.deleteTexture(object),
    attach: (gl, target, object) => gl.bindTexture(target, object),
    exists: (gl, object) => gl.isTexture(object),
    bound: (state, target, handle) => state.shadowed((shadow) => shadow.texture(target, handle)),
  });
  install<WebGLFramebuffer>(host, {
    kind: HandleKind.Framebuffer,
    create: (gl) => gl.createFramebuffer(),
    register: (state, object) => state.handles.framebuffer(object),
    lookup: (state, handle) => state.handles.getFramebuffer(handle),
    destroy: (gl, object) => gl.deleteFramebuffer(object),
    attach: (gl, target, object) => gl.bindFramebuffer(target, object),
    exists: (gl, object) => gl.isFramebuffer(object),
  });
  install<WebGLRenderbuffer>(host, {
    kind: HandleKind.Renderbuffer,
    accounting: host.memory.Renderbuffer,
    create: (gl) => gl.createRenderbuffer(),
    register: (state, object) => state.handles.renderbuffer(object),
    lookup: (state, handle) => state.handles.getRenderbuffer(handle),
    destroy: (gl, object) => gl.deleteRenderbuffer(object),
    attach: (gl, target, object) => gl.bindRenderbuffer(target, object),
    exists: (gl, object) => gl.isRenderbuffer(object),
  });
}
