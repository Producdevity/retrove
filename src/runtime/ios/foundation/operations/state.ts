import { OperationClass, type OperationHost, pointer } from "./host";
interface Invocation {
  readonly target: number;
  readonly selector: string;
  readonly argument: number;
}
interface Operation {
  state: "ready" | "executing" | "finished";
  cancelled: boolean;
  readonly dependencies: Set<number>;
  invocation?: Invocation;
  result: number;
  voidResult?: boolean;
}
export class Operations {
  private readonly states = new Map<number, Operation>();
  constructor(private readonly host: OperationHost) {}
  get(self: number): Operation {
    let operation = this.states.get(self);
    if (!operation) {
      operation = { state: "ready", cancelled: false, dependencies: new Set(), result: 0 };
      this.states.set(self, operation);
    }
    return operation;
  }
  async ready(self: number): Promise<boolean> {
    const state = this.get(self);
    if (state.cancelled) return true;
    for (const dependency of state.dependencies)
      if (!(await this.host.send(dependency, "isFinished"))) return false;
    return true;
  }
  addDependency(self: number, dependency: number): void {
    if (self === dependency || !this.host.isKind(dependency, OperationClass.Base))
      throw new Error("Invalid operation dependency.");
    const state = this.get(self);
    if (state.state !== "ready") throw new Error("Cannot change dependencies after starting.");
    if (!state.dependencies.has(dependency)) state.dependencies.add(this.host.retain(dependency));
  }
  async removeDependency(self: number, dependency: number): Promise<void> {
    if (this.get(self).dependencies.delete(dependency)) await this.host.release(dependency);
  }
  async start(self: number): Promise<void> {
    const state = this.get(self);
    if (state.state === "finished") return;
    if (state.state !== "ready") throw new Error("Operation is already executing.");
    if (!(await this.host.send(self, "isReady")))
      throw new Error("Operation dependencies are unfinished.");
    if (!state.cancelled) {
      state.state = "executing";
      try {
        await this.host.send(self, "main");
      } finally {
        state.state = "finished";
      }
    } else state.state = "finished";
  }
  async initializeInvocation(
    self: number,
    target: number,
    selector: number,
    argument: number,
  ): Promise<number> {
    if (!target || !selector) {
      await this.destroy(self);
      return 0;
    }
    const state = this.get(self);
    if (state.invocation) throw new Error("Invocation operation is already initialized.");
    state.invocation = {
      target: this.host.retain(target),
      selector: this.host.selector(selector),
      argument: this.host.retain(argument),
    };
    return self;
  }
  async invoke(self: number): Promise<void> {
    const state = this.get(self),
      invocation = state.invocation;
    if (!invocation) throw new Error("Uninitialized invocation operation.");
    const type = this.host.returnType(invocation.target, invocation.selector);
    if (type !== "v" && type !== "@" && type !== "#")
      throw new Error("Unsupported invocation operation result type: " + type);
    const result = await this.host.send(invocation.target, invocation.selector, [
      invocation.argument,
    ]);
    state.voidResult = type === "v";
    if (!state.voidResult) state.result = this.host.retain(pointer(result));
  }
  async changed(self: number): Promise<void> {
    const state = this.states.get(self);
    if (state && (await this.host.send(self, "isFinished"))) state.state = "finished";
  }
  async destroy(self: number): Promise<void> {
    const state = this.states.get(self);
    this.states.delete(self);
    if (state) {
      for (const dependency of state.dependencies) await this.host.release(dependency);
      if (state.invocation) {
        await this.host.release(state.invocation.target);
        await this.host.release(state.invocation.argument);
      }
      await this.host.release(state.result);
    }
    this.host.destroy(self);
  }
}
