import { write32 } from "../../memory/guest-memory";
import { words2, words3, words4 } from "./arguments";
import { Gles, JS_COPY } from "./constants";
import type { GlesContext } from "./context";
import { sourceBytes } from "./data";

function installUploads(host: GlesContext): void {
  host.bind("BufferData", (a) => {
    const [target, size, pointer, usage] = words4(a);
    const bytes = pointer ? sourceBytes(host.cpu, pointer, size) : null;
    if (bytes) host.gl().bufferData(target, bytes, usage);
    else host.gl().bufferData(target, size, usage);
    const name = target === Gles.ArrayBuffer ? host.array : host.elements;
    if (!name) return;
    const previous = host.bufferData.get(name);
    // A same-sized respecification keeps the guest block that MapBufferOES hands out.
    const block = previous?.size === size ? previous.block : host.releaseMapping(previous);
    if (block) block.current = false;
    host.mapped.delete(name);
    host.bufferData.set(name, { size, bytes, block });
    host.memory.Buffer.set(name, 0, size);
    host.memory.Buffer.set(name, JS_COPY, bytes ? size : 0);
  });
  host.bind("BufferSubData", (a) => {
    const [target, offset, size, pointer] = words4(a);
    const bytes = sourceBytes(host.cpu, pointer, size);
    host.gl().bufferSubData(target, offset, bytes);
    const backing = host.bufferData.get(target === Gles.ArrayBuffer ? host.array : host.elements);
    if (!backing || offset + bytes.length > backing.size) return;
    backing.bytes ??= new Uint8Array(backing.size);
    backing.bytes.set(bytes, offset);
    if (backing.block) backing.block.current = false;
  });
}

/** The OES_mapbuffer window onto a buffer's host copy. */
function installMapping(host: GlesContext): void {
  host.bind("MapBufferOES", (a) => {
    const [target, access] = words2(a);
    if (access !== Gles.WriteOnlyOes) {
      host.setError(Gles.InvalidEnum);
      return 0;
    }
    const name = host.boundBuffer(target),
      backing = host.bufferData.get(name);
    if (!name || !backing || host.mapped.has(name)) {
      host.setError(Gles.InvalidOperation);
      return 0;
    }
    // Each buffer keeps one guest block across maps; it is rewritten only when the buffer changed since the last unmap.
    let block = backing.block;
    if (!block) {
      const pointer = host.heap.alloc(backing.size);
      if (!pointer) {
        host.setError(Gles.OutOfMemory);
        return 0;
      }
      block = { pointer, current: false };
      backing.block = block;
    }
    if (!block.current)
      host.cpu.write(block.pointer, backing.bytes ?? new Uint8Array(backing.size));
    host.mapped.set(name, block.pointer);
    return block.pointer;
  });
  host.bind("UnmapBufferOES", (a) => {
    const target = a(0),
      name = host.boundBuffer(target),
      pointer = host.mapped.get(name),
      backing = host.bufferData.get(name);
    if (!pointer || !backing) {
      host.setError(Gles.InvalidOperation);
      return 0;
    }
    const bytes = sourceBytes(host.cpu, pointer, backing.size);
    host.gl().bufferSubData(target, 0, bytes);
    backing.bytes = bytes;
    if (backing.block) backing.block.current = true;
    host.mapped.delete(name);
    return 1;
  });
  host.bind("GetBufferPointervOES", (a) => {
    const [target, name, pointer] = words3(a);
    if (name !== Gles.BufferMapPointerOes) {
      host.setError(Gles.InvalidEnum);
      return;
    }
    write32(host.cpu, pointer, host.mapped.get(host.boundBuffer(target)) ?? 0);
  });
}

export function installBuffers(host: GlesContext): void {
  installUploads(host);
  installMapping(host);
  host.bind("GetBufferParameteriv", (a) => {
    const [target, name, pointer] = words3(a);
    write32(host.cpu, pointer, Number(host.gl().getBufferParameter(target, name)));
  });
}
