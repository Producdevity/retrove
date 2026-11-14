import { createCPU } from '../../web/cpu.mjs';
import { Heap, read32, write32 } from '../../web/memory.mjs';
import { objcImports } from '../../web/objc.mjs';

export async function fixture(t, call = () => {}, files = new Map(), options = {}) {
  const cpu = await createCPU();
  t.onTestFinished(() => cpu.close());
  const heap = new Heap(cpu);
  const ipa = { info: {CFBundleIdentifier: 'com.test.fixture'}, bundlePath: 'Payload/Test.app', has: p => files.has(p), read: async p => files.get(p) };
  const objc = objcImports(cpu, heap, ipa, () => ({}), call, undefined, undefined, typeof options==='function'?options(cpu,heap):options);
  const write = (p, v) => write32(cpu, p, v), read = p => read32(cpu, p);
  const f = (name, ...args) => objc.funcs[name](i => args[i] || 0);
  const sel = name => f('_sel_registerName', heap.string(name));
  const send = (self, name, ...args) => f('_objc_msgSend', self, sel(name), ...args);
  const cls = name => objc.resolveData('_OBJC_CLASS_$_' + name);
  function instance(name, instanceMethods, classMethods = [], base = cls('NSObject')) {
    const ptr = heap.zero(20), meta = heap.zero(20);
    for (const [p, methods, isa, parent] of [[ptr, instanceMethods, meta, base], [meta, classMethods, read(read(base)), read(base)]]) {
      const data = heap.zero(40), list = heap.zero(8 + methods.length * 12);
      write(p, isa); write(p + 4, parent); write(p + 16, data);
      write(data + 8, p === ptr ? 4 : 20); write(data + 16, heap.string(name)); write(data + 20, list);
      write(list, 12); write(list + 4, methods.length);
      methods.forEach(([selector, imp], i) => {
        const at = list + 8 + i * 12;
        write(at, heap.string(selector)); write(at + 8, imp);
      });
    }
    return ptr;
  }
  function install(lists) {
    const sections = Object.entries(lists).map(([name, entries]) => {
      const address = heap.zero(entries.length * 4);
      entries.forEach((value, i) => write(address + i * 4, value));
      return {name, size:entries.length * 4, address};
    });
    objc.install({segments:[{sections}]});
  }
  return {cpu, heap, objc, f, sel, send, cls, read, write, instance, install};
}
