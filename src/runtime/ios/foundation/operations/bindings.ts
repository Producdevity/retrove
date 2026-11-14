import { Argument } from "../../objc/host";
import { OperationClass, type OperationHost } from "./host";
import { Operations } from "./state";
import { OperationQueues } from "./queues";
export function installOperations(host: OperationHost) {
  host.hostClass(OperationClass.Base, "NSObject");
  host.hostClass(OperationClass.Invocation, OperationClass.Base);
  const queueClass = host.hostClass(OperationClass.Queue, "NSObject");
  const operations = new Operations(host),
    queues = new OperationQueues(host, queueClass);
  installOperationMethods(host, operations);
  installQueueMethods(host, queues);
  return {
    main: () => queues.main(),
    pending: () => queues.pending(),
    pump: (main: boolean) => queues.pump(main),
    changed: async (self: number) => {
      await operations.changed(self);
      await queues.pump(false);
    },
  };
}
function installOperationMethods(host: OperationHost, operations: Operations): void {
  const base = OperationClass.Base,
    invocation = OperationClass.Invocation;
  host.method(base, false, "init", (self) => {
    operations.get(self);
    return self;
  });
  host.method(base, false, "start", (self) => operations.start(self));
  host.method(base, false, "main", () => {});
  host.method(base, false, "isExecuting", (self) =>
    Number(operations.get(self).state === "executing"),
  );
  host.method(base, false, "isFinished", (self) =>
    Number(operations.get(self).state === "finished"),
  );
  host.method(base, false, "isCancelled", (self) => Number(operations.get(self).cancelled));
  host.method(base, false, "isReady", async (self) => Number(await operations.ready(self)));
  for (const selector of ["isConcurrent", "isAsynchronous"])
    host.method(base, false, selector, () => 0);
  host.method(base, false, "cancel", (self) => {
    operations.get(self).cancelled = true;
  });
  host.method(base, false, "addDependency:", (self, args) =>
    operations.addDependency(self, args(Argument.First)),
  );
  host.method(base, false, "removeDependency:", (self, args) =>
    operations.removeDependency(self, args(Argument.First)),
  );
  host.method(base, false, "dependencies", (self) =>
    host.autorelease(host.array([...operations.get(self).dependencies])),
  );
  host.waitMethod(base, "waitUntilFinished", async (self) => ({
    wait: () => (operations.get(self).state === "finished" ? 0 : undefined),
  }));
  host.method(base, false, "dealloc", (self) => operations.destroy(self));
  host.method(invocation, false, "initWithTarget:selector:object:", (self, args) =>
    operations.initializeInvocation(
      self,
      args(Argument.First),
      args(Argument.Second),
      args(Argument.Third),
    ),
  );
  host.method(invocation, false, "main", (self) => operations.invoke(self));
  host.method(invocation, false, "result", (self) => {
    const operation = operations.get(self);
    if (operation.state !== "finished") throw new Error("Invocation operation has not finished.");
    if (operation.voidResult) throw new Error("NSInvocationOperationVoidResultException");
    return host.autorelease(host.retain(operation.result));
  });
}
function installQueueMethods(host: OperationHost, queues: OperationQueues): void {
  const queue = OperationClass.Queue;
  host.method(queue, true, "mainQueue", () => queues.main());
  host.method(queue, false, "init", (self) => {
    queues.get(self);
    return self;
  });
  host.method(queue, false, "addOperation:", (self, args) =>
    queues.add(self, args(Argument.First)),
  );
  host.method(queue, false, "operations", (self) => {
    const state = queues.get(self);
    return host.autorelease(host.array([...state.pending, ...state.active]));
  });
  host.method(queue, false, "operationCount", (self) => {
    const state = queues.get(self);
    return state.pending.length + state.active.size;
  });
  host.method(queue, false, "isSuspended", (self) => Number(queues.get(self).suspended));
  host.method(queue, false, "setSuspended:", async (self, args) => {
    queues.get(self).suspended = Boolean(args(Argument.First));
    await queues.pump(false);
  });
  host.method(queue, false, "maxConcurrentOperationCount", (self) => queues.get(self).maximum);
  host.method(queue, false, "setMaxConcurrentOperationCount:", async (self, args) => {
    const value = args(Argument.First) | 0;
    if (value < -1) throw new Error("Invalid operation concurrency limit.");
    queues.get(self).maximum = value;
    await queues.pump(false);
  });
  host.method(queue, false, "cancelAllOperations", (self) => queues.cancel(self));
  host.waitMethod(queue, "waitUntilAllOperationsAreFinished", async (self) => ({
    wait: () => {
      const state = queues.get(self);
      return state.pending.length + state.active.size === 0 ? 0 : undefined;
    },
  }));
  host.method(queue, false, "dealloc", (self) => queues.destroy(self));
}
