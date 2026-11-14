import { AlertCallback } from "./types";
import type { AlertLifecycleHost, AlertPresentation, AlertState } from "./types";
export class Alerts {
  private readonly states = new Map<number, AlertState>();
  private readonly selections = new Map<number, number | undefined>();
  constructor(
    private readonly host: AlertLifecycleHost,
    private readonly present: AlertPresentation,
  ) {}
  get(pointer: number): AlertState {
    let state = this.states.get(pointer);
    if (!state) {
      state = {
        title: undefined,
        message: undefined,
        buttons: [],
        cancel: -1,
        delegate: 0,
        firstOther: -1,
        phase: "hidden",
        output: undefined,
        held: false,
      };
      this.states.set(pointer, state);
    }
    return state;
  }
  update(pointer: number): void {
    const state = this.get(pointer);
    state.output?.update(state);
  }
  visible(pointer: number): boolean {
    return this.get(pointer).phase !== "hidden";
  }
  pending(): boolean {
    return [...this.states.values()].some((state) => state.held);
  }
  private async notify(state: AlertState, selector: string, args: number[]): Promise<void> {
    if (state.delegate) await this.host.send(state.delegate, selector, args, true);
  }
  async show(pointer: number): Promise<void> {
    const state = this.get(pointer);
    if (state.phase !== "hidden") return;
    this.host.retain(pointer);
    state.held = true;
    state.phase = "presenting";
    try {
      await this.notify(state, AlertCallback.WillPresent, [pointer]);
      if (state.phase !== "presenting") return;
      state.output = this.present(state, (index) => {
        if (state.phase === "visible" && !this.selections.has(pointer))
          this.selections.set(pointer, index);
      });
      state.phase = "visible";
      await this.notify(state, AlertCallback.DidPresent, [pointer]);
    } catch (error) {
      await this.hide(pointer, state);
      throw error;
    }
  }
  private async hide(pointer: number, state: AlertState): Promise<void> {
    state.output?.close();
    state.output = undefined;
    state.phase = "hidden";
    this.selections.delete(pointer);
    if (state.held) {
      state.held = false;
      await this.host.release(pointer);
    }
  }
  async dismiss(pointer: number, index: number, user = false): Promise<void> {
    const state = this.get(pointer);
    if (state.phase === "hidden" || state.phase === "dismissing") return;
    state.phase = "dismissing";
    const held = state.held;
    state.held = false;
    try {
      if (user) await this.notify(state, AlertCallback.Click, [pointer, index]);
      await this.notify(state, AlertCallback.WillDismiss, [pointer, index]);
    } finally {
      state.output?.close();
      state.output = undefined;
      state.phase = "hidden";
      this.selections.delete(pointer);
      try {
        await this.notify(state, AlertCallback.DidDismiss, [pointer, index]);
      } finally {
        if (held) await this.host.release(pointer);
      }
    }
  }
  async pump(): Promise<void> {
    for (const [pointer, selection] of [...this.selections]) {
      this.selections.delete(pointer);
      const state = this.states.get(pointer);
      if (!state || state.phase !== "visible") continue;
      if (selection !== undefined) await this.dismiss(pointer, selection, true);
      else if (state.cancel >= 0) {
        const handlesCancel = this.host.responds(state.delegate, AlertCallback.Cancel);
        if (handlesCancel) await this.notify(state, AlertCallback.Cancel, [pointer]);
        await this.dismiss(pointer, state.cancel, !handlesCancel);
      }
    }
  }
  async destroy(pointer: number): Promise<void> {
    this.states.get(pointer)?.output?.close();
    this.states.delete(pointer);
    this.selections.delete(pointer);
    await this.host.deallocateView(pointer);
  }
  close(): void {
    for (const state of this.states.values()) state.output?.close();
    this.states.clear();
    this.selections.clear();
  }
}
