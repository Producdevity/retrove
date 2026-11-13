export interface TouchCanvas extends EventTarget {
  readonly style: { touchAction: string };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}
export interface TouchEventRecord {
  readonly phase: number;
  readonly allPhases: readonly number[];
  readonly target: number;
  readonly expected: number;
  readonly point: readonly number[];
  readonly previous: readonly number[];
  readonly count: number;
  readonly touch: number;
}
export interface TouchHarness {
  readonly events: TouchEventRecord[];
  stop(): Promise<void>;
}
export function startTouchTest(canvas: TouchCanvas,orientation?: string,options?:{readonly multiple?: boolean;readonly onTurn?:()=>void}):Promise<TouchHarness>;
