import { Placement, type ThreadRule } from "../../../cpu/worker/placement";

/** FRunnableThreadIPhone::Create stores the runnable before pthread_create; vtable slot 1 is Run. */
const RunnableThread = { Runnable: 0x0c, Vtable: 0, Run: 4 } as const;

/**
 * With worker threads on, the game thread (started by NSThread) and the rendering thread run in
 * parallel with the UIKit main thread. Unreal Engine 3 starts every other thread through FRunnableThreadIPhone::_ThreadProc;
 * the rendering thread is the one whose runnable is an ES2RenderingThread. It makes nearly all GL
 * calls.
 */
export const bioShockThreads: readonly ThreadRule[] = [
  { entry: "-[IPhoneAppDelegate MainUE3GameThread:]", placement: Placement.Worker },
  {
    entry: "__ZN21FRunnableThreadIPhone11_ThreadProcEPv",
    target: {
      path: [RunnableThread.Runnable, RunnableThread.Vtable, RunnableThread.Run],
      symbol: "__ZN18ES2RenderingThread3RunEv",
    },
    placement: Placement.Graphics,
  },
];
