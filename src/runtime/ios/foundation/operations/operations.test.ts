import { expect, test, vi } from "vite-plus/test";
import type { HostMethod, HostResult, GuestArguments } from "../../objc/host";
import { installOperations } from "./bindings";
import type { OperationHost } from "./host";
interface Job {
  task(): Promise<void>;
  exited(): Promise<void>;
}
function fixture() {
  let next = 100;
  const classes = new Map<string, number>(),
    parents = new Map<number, string>(),
    names = new Map<number, string>();
  const instances = new Map<number, number>(),
    methods = new Map<string, HostMethod>(),
    arrays = new Map<number, number[]>();
  const jobs: Job[] = [],
    types = new Map<string, string>(),
    destroyed = new Set<number>();
  const waits = new Map<
    string,
    (self: number, args: GuestArguments) => Promise<{ wait(): number | undefined }>
  >();
  const retain = vi.fn((value: number) => value);
  const release = vi.fn((_value: number) => Promise.resolve());
  const host: OperationHost = {
    hostClass(name, parent) {
      const id = next++;
      classes.set(name, id);
      names.set(id, name);
      parents.set(id, parent);
      return id;
    },
    method(name, meta, selector, method) {
      methods.set(`${name}:${meta}:${selector}`, method);
    },
    alloc(cls) {
      const id = next++;
      instances.set(id, cls);
      return id;
    },
    destroy(pointer) {
      destroyed.add(pointer);
    },
    retain,
    release,
    autorelease: (value) => value,
    text: (value) => String(value),
    string: (value) => Number(value),
    write: () => {},
    selector: (value) => String(value),
    returnType: (target, name) => types.get(`${target}:${name}`) ?? "@",
    array(values) {
      const id = next++;
      arrays.set(id, values);
      return id;
    },
    items: (pointer) => arrays.get(pointer) ?? [],
    isKind(self, name) {
      for (let cls = instances.get(self); cls; cls = classes.get(parents.get(cls) ?? ""))
        if (names.get(cls) === name) return true;
      return false;
    },
    async send(self, selector, args = []): Promise<HostResult> {
      const meta = !instances.has(self);
      for (
        let cls = instances.get(self) ?? self;
        cls;
        cls = classes.get(parents.get(cls) ?? "") ?? 0
      ) {
        const method = methods.get(`${names.get(cls)}:${meta}:${selector}`);
        if (method) return method(self, (index) => args[index] ?? 0);
      }
      throw new Error(`Missing ${self} ${selector}`);
    },
    worker(_operation, task, exited) {
      jobs.push({ task, exited });
    },
    waitMethod(cls, selector, method) {
      waits.set(`${cls}:${selector}`, method);
    },
  };
  host.hostClass("NSObject", "");
  const operations = installOperations(host);
  const make = (name: string) => {
    const cls = classes.get(name);
    if (!cls) throw new Error("Unknown class");
    return host.alloc(cls);
  };
  const flush = async () => {
    while (jobs.length) {
      const job = jobs.shift();
      if (job) {
        await job.task();
        await job.exited();
      }
    }
  };
  return { host, operations, make, jobs, flush, types, destroyed, waits, retain, release };
}
test("cancelled operations finish without invoking main; starting a finished operation is harmless", async () => {
  const x = fixture(),
    operation = x.make("NSOperation"),
    main = vi.fn();
  x.host.method("NSOperation", false, "main", main);
  await x.host.send(operation, "cancel");
  await x.host.send(operation, "start");
  await x.host.send(operation, "start");
  expect(main).not.toHaveBeenCalled();
  expect(await x.host.send(operation, "isCancelled")).toBe(1);
  expect(await x.host.send(operation, "isExecuting")).toBe(0);
  expect(await x.host.send(operation, "isFinished")).toBe(1);
});
test("suspended serial queues honor dependencies and retain operations until they finish", async () => {
  const x = fixture(),
    queue = x.make("NSOperationQueue"),
    first = x.make("NSOperation"),
    second = x.make("NSOperation"),
    order: number[] = [];
  x.host.method("NSOperation", false, "main", (self) => {
    order.push(self);
  });
  await x.host.send(queue, "setMaxConcurrentOperationCount:", [1]);
  await x.host.send(queue, "setSuspended:", [1]);
  await x.host.send(second, "addDependency:", [first]);
  await x.host.send(queue, "addOperation:", [second]);
  await x.host.send(queue, "addOperation:", [first]);
  expect(x.jobs).toHaveLength(0);
  await x.host.send(queue, "setSuspended:", [0]);
  expect(x.jobs).toHaveLength(1);
  await x.flush();
  expect(order).toEqual([first, second]);
  expect(await x.host.send(queue, "operationCount")).toBe(0);
  expect(x.release).toHaveBeenCalledWith(first);
  expect(x.release).toHaveBeenCalledWith(second);
});
test("an asynchronous subclass stays active after start returns until its own finished getter changes", async () => {
  const x = fixture();
  let finished = false;
  x.host.hostClass("AsyncOperation", "NSOperation");
  const queue = x.make("NSOperationQueue"),
    operation = x.make("AsyncOperation"),
    next = x.make("NSOperation");
  x.host.method("AsyncOperation", false, "start", () => {});
  x.host.method("AsyncOperation", false, "isFinished", () => Number(finished));
  await x.host.send(queue, "setMaxConcurrentOperationCount:", [1]);
  await x.host.send(queue, "addOperation:", [operation]);
  await x.host.send(queue, "addOperation:", [next]);
  await x.flush();
  expect(await x.host.send(queue, "operationCount")).toBe(2);
  finished = true;
  await x.operations.changed(operation);
  await x.flush();
  expect(await x.host.send(queue, "operationCount")).toBe(0);
});
test("main-queue operations execute on the main pump rather than a worker", async () => {
  const x = fixture(),
    queue = x.operations.main(),
    operation = x.make("NSOperation"),
    main = vi.fn();
  x.host.method("NSOperation", false, "main", main);
  await x.host.send(queue, "addOperation:", [operation]);
  await x.operations.pump(false);
  expect(main).not.toHaveBeenCalled();
  expect(x.jobs).toHaveLength(0);
  await x.operations.pump(true);
  expect(main).toHaveBeenCalledTimes(1);
  expect(await x.host.send(queue, "operationCount")).toBe(0);
});
test("invocation operations preserve arguments and object results without retaining a void return register", async () => {
  const x = fixture();
  x.host.hostClass("Target", "NSObject");
  const target = x.make("Target"),
    operation = x.make("NSInvocationOperation"),
    invoke = vi.fn(() => 456);
  x.host.method("Target", false, "123", invoke);
  await x.host.send(operation, "initWithTarget:selector:object:", [target, 123, 789]);
  await x.host.send(operation, "start");
  expect(invoke).toHaveBeenCalled();
  expect(await x.host.send(operation, "result")).toBe(456);
  await x.host.send(operation, "dealloc");
  expect(x.release).toHaveBeenCalledWith(target);
  expect(x.release).toHaveBeenCalledWith(789);
  expect(x.release).toHaveBeenCalledWith(456);
  const other = x.make("NSInvocationOperation");
  x.types.set(`${target}:123`, "v");
  x.retain.mockClear();
  await x.host.send(other, "initWithTarget:selector:object:", [target, 123, 0]);
  await x.host.send(other, "start");
  expect(x.retain).not.toHaveBeenCalledWith(456);
  await expect(x.host.send(other, "result")).rejects.toThrow("VoidResultException");
});
