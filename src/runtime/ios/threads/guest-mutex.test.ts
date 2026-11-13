import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../web/cpu.mjs";
import { ExecutionBudget } from "../../cpu/execution-budget";
import { guestMutexFunctions } from "./guest-mutex";
import { GuestMutexes, MutexLayout, MutexType, StaticMutex } from "./mutex";
async function fixture() {
  const cpu = await createCPU({ budget: ExecutionBudget.Blocks });
  const code = 0x1000,
    data = 0x8000,
    fallback = 0x4000,
    done = 0x5000,
    tls = 0x8800;
  for (const address of [code, data, fallback, done]) cpu.map(address, 4096);
  const memory = {
    read: (address: number) => new DataView(cpu.read(address, 4).buffer).getUint32(0, true),
    write: (address: number, value: number) => {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, value, true);
      cpu.write(address, bytes);
    },
  };
  const mutexes = new GuestMutexes(memory);
  const helpers = guestMutexFunctions(
    cpu,
    { alloc: () => code },
    {
      budget: ExecutionBudget.Blocks,
      lock: fallback,
      unlock: fallback + 4,
    },
  );
  cpu.threadPointer = tls;
  const releases = [cpu.trap(fallback, () => {}), cpu.trap(fallback + 4, () => {})];
  function address(name: string): number {
    const value = helpers.get(name);
    if (value === undefined) throw new Error("Missing mutex helper.");
    return value;
  }
  function start(name: string, thread: number): number {
    memory.write(tls, thread);
    cpu.setReg(0, data);
    cpu.setReg(14, done);
    return address(name);
  }
  function call(name: string, thread: number) {
    const result = cpu.run(start(name, thread), { until: done });
    return { ...result, value: cpu.getReg(0) };
  }
  return {
    cpu,
    data,
    done,
    memory,
    mutexes,
    start,
    call,
    close() {
      for (const release of releases) release();
      cpu.close();
    },
  };
}
test("ARM mutexes share ownership and recursive depth with the host scheduler", async () => {
  const f = await fixture();
  try {
    for (const type of Object.values(MutexType)) {
      f.mutexes.initialize(f.data, type);
      for (let register = 4; register <= 11; register++) f.cpu.setReg(register, register * 17);
      expect(f.call("_pthread_mutex_lock", 1)).toMatchObject({ reason: "until", value: 0 });
      expect(f.mutexes.ownsOnce(f.data, 1)).toBe(true);
      expect(f.call("_pthread_mutex_lock", 2).reason).toBe("trap");
      expect(f.cpu.getReg(0)).toBe(f.data);
      expect(f.call("_pthread_mutex_unlock", 2).reason).toBe("trap");
      const relock = f.call("_pthread_mutex_lock", 1);
      if (type === MutexType.Recursive) {
        expect(relock.reason).toBe("until");
        expect(f.memory.read(f.data + MutexLayout.Depth)).toBe(2);
        expect(f.call("_pthread_mutex_unlock", 1).reason).toBe("until");
      } else expect(relock.reason).toBe("trap");
      expect(f.call("_pthread_mutex_unlock", 1)).toMatchObject({ reason: "until", value: 0 });
      expect(f.memory.read(f.data + MutexLayout.Owner)).toBe(0);
      for (let register = 4; register <= 11; register++)
        expect(f.cpu.getReg(register)).toBe(register * 17);
    }
    f.memory.write(f.data, StaticMutex.Recursive);
    expect(f.call("_pthread_mutex_lock", 1).reason).toBe("trap");
    expect(f.mutexes.lock(f.data, 1, false)).toBe(0);
    f.memory.write(f.data + MutexLayout.Depth, MutexLayout.MaximumDepth);
    expect(f.call("_pthread_mutex_lock", 1).reason).toBe("trap");
    expect(f.memory.read(f.data + MutexLayout.Depth)).toBe(MutexLayout.MaximumDepth);
  } finally {
    f.close();
  }
});
test("block preemption never exposes partially acquired or released ARM mutexes", async () => {
  const f = await fixture();
  try {
    for (const operation of ["_pthread_mutex_lock", "_pthread_mutex_unlock"]) {
      f.mutexes.initialize(f.data, MutexType.Normal);
      if (operation === "_pthread_mutex_unlock") f.mutexes.take(f.data, 1);
      let pc = f.start(operation, 1);
      let finished = false;
      for (let slice = 0; slice < 20 && !finished; slice++) {
        const result = f.cpu.run(pc, { until: f.done, count: 1 });
        const owner = f.memory.read(f.data + MutexLayout.Owner);
        const depth = f.memory.read(f.data + MutexLayout.Depth);
        expect([owner, depth]).toEqual(owner ? [1, 1] : [0, 0]);
        if (!owner) {
          expect(f.mutexes.take(f.data, 2)).toBe(0);
          expect(f.mutexes.unlock(f.data, 2)).toBe(0);
        } else expect(f.mutexes.take(f.data, 2)).toBeUndefined();
        finished = result.reason === "until";
        pc = result.pc;
      }
      expect(finished).toBe(true);
    }
  } finally {
    f.close();
  }
});
test("a competing owner cannot be overwritten when the ARM helper resumes", async () => {
  const f = await fixture();
  try {
    for (const operation of ["_pthread_mutex_lock", "_pthread_mutex_unlock"])
      for (let prefix = 0; prefix < 5; prefix++) {
        f.mutexes.initialize(f.data, MutexType.Normal);
        if (operation === "_pthread_mutex_unlock") f.mutexes.take(f.data, 1);
        let pc = f.start(operation, 1);
        let finished = false;
        for (let slice = 0; slice < prefix; slice++) {
          const result = f.cpu.run(pc, { until: f.done, count: 1 });
          pc = result.pc;
          if (result.reason === "until") {
            finished = true;
            break;
          }
        }
        if (finished || f.memory.read(f.data + MutexLayout.Owner)) continue;
        expect(f.mutexes.take(f.data, 2)).toBe(0);
        const result = f.cpu.run(pc, { until: f.done });
        expect(f.mutexes.ownsOnce(f.data, 2)).toBe(true);
        expect(result.reason).toBe(operation === "_pthread_mutex_lock" ? "trap" : "until");
        expect(f.mutexes.unlock(f.data, 2)).toBe(0);
      }
  } finally {
    f.close();
  }
});
