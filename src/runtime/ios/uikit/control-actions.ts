export const ControlState = { Normal: 0, Highlighted: 1, Disabled: 2, Selected: 4 } as const;
export const ControlEvent = {
  Down: 1,
  Repeat: 2,
  DragInside: 4,
  DragOutside: 8,
  DragEnter: 16,
  DragExit: 32,
  UpInside: 64,
  UpOutside: 128,
  Cancel: 256,
  EditingDidBegin: 0x10000,
  EditingChanged: 0x20000,
  EditingDidEnd: 0x40000,
  EditingDidEndOnExit: 0x80000,
} as const;
interface Action {
  readonly id: number;
  readonly target: number;
  readonly selector: number;
  events: number;
}
export class ControlActions {
  private readonly actions: Action[] = [];
  private nextId = 0;
  add(target: number, selector: number, events: number): void {
    if (!selector) throw new Error("A control action requires a selector.");
    if (!events) return;
    const existing = this.actions.find(
      (action) => action.target === target && action.selector === selector,
    );
    if (existing) existing.events |= events;
    else this.actions.push({ id: ++this.nextId, target, selector, events });
  }
  remove(target: number, selector: number, events: number): void {
    for (let index = this.actions.length - 1; index >= 0; index--) {
      const action = this.actions[index];
      if (!action) continue;
      if ((!target || action.target === target) && (!selector || action.selector === selector))
        action.events &= ~events;
      if (!action.events) this.actions.splice(index, 1);
    }
  }
  get events(): number {
    return this.actions.reduce((events, action) => events | action.events, 0);
  }
  async dispatch(
    events: number,
    invoke: (target: number, selector: number) => Promise<void>,
  ): Promise<void> {
    const last = this.nextId;
    let visited = 0;
    while (true) {
      const action = this.actions.find(
        (candidate) =>
          candidate.id > visited && candidate.id <= last && (candidate.events & events) !== 0,
      );
      if (!action) return;
      visited = action.id;
      await invoke(action.target, action.selector);
    }
  }
}
