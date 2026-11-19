const NO_ERROR = 0;
const DRIVER_QUERY_INTERVAL_MS = 16;

// WebGL getError is a synchronous GPU-process round trip and games call glGetError hundreds of
// times per frame, so emulated errors are always reported while driver errors are sampled.
export class GLErrorState {
  #pending = NO_ERROR;
  #lastDriverQuery = -Infinity;

  record(code: number): void {
    if (this.#pending === NO_ERROR) this.#pending = code;
  }

  /** Whether the next glGetError should sample the driver. */
  driverDue(now: number): boolean {
    return now - this.#lastDriverQuery >= DRIVER_QUERY_INTERVAL_MS;
  }

  take(queryDriver: () => number, now: number): number {
    const code = this.#pending;
    this.#pending = NO_ERROR;
    if (code !== NO_ERROR) return code;
    if (now - this.#lastDriverQuery < DRIVER_QUERY_INTERVAL_MS) return NO_ERROR;
    this.#lastDriverQuery = now;
    return queryDriver();
  }
}
