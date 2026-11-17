const MAX_STEP_SECONDS = 0.034;
const MILLISECONDS = 1000;
const REST_DISTANCE = 0.002;
const REST_VELOCITY = 0.02;

/** A damped spring, stepped once per animation frame. */
export class Spring {
  velocity = 0;
  constructor(
    public value: number,
    public target: number,
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}
  step(milliseconds: number): void {
    const seconds = Math.min(milliseconds / MILLISECONDS, MAX_STEP_SECONDS);
    this.velocity += (this.target - this.value) * this.stiffness * seconds;
    this.velocity *= Math.exp(-this.damping * seconds);
    this.value += this.velocity * seconds;
  }
  jump(value: number): void {
    this.value = this.target = value;
    this.velocity = 0;
  }
  get settled(): boolean {
    const scale = Math.max(1, Math.abs(this.target));
    return (
      Math.abs(this.target - this.value) < REST_DISTANCE * scale &&
      Math.abs(this.velocity) < REST_VELOCITY * scale
    );
  }
}
