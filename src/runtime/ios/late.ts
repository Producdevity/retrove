/** A service installed after the code that calls it, resolved when the call happens. */
export class Late<T> {
  private held: T | undefined;
  constructor(private readonly name: string) {}
  set(value: T): void {
    this.held = value;
  }
  peek(): T | undefined {
    return this.held;
  }
  get(): T {
    if (this.held === undefined) throw new Error(`${this.name} is not installed.`);
    return this.held;
  }
}
