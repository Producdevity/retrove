import { DropReason } from "../../../diagnostics/input-metrics";
import { ScrollTiming } from "../scroll/state";
import { touchConflict } from "./view-policy";
import type { TouchRecord, UiContext } from "./context";
import { classPointer } from "./context";
import { BEGAN_SELECTOR, CANCELLED_SELECTOR, POINTER_PHASES } from "./phases";
import { PointerPhase, TouchPhase } from "./pointer-queue";
import type { PointerSample } from "./pointer-queue";
import { toPoint } from "./view-data";
import type { PointLike } from "./view-data";

const MILLISECONDS_PER_SECOND = 1000;
const DOUBLE_TAP_SECONDS = 0.35;
const DOUBLE_TAP_DISTANCE = 10;
const GL_LAYER_CLASS = "CAEAGLLayer";

type Hit = (self: number, x: number, y: number) => number;
type Layout = (view: number) => Promise<void>;

function createDelivery(ctx: UiContext) {
  const { state, geo, collections, alloc, names, className, send, releaseFromHost } = ctx;
  return async (
    touch: TouchRecord,
    sample: PointerSample,
    phase: number,
    selector: string,
    target = touch.target,
  ): Promise<void> => {
    for (const other of state.active.values()) {
      other.phase = TouchPhase.Stationary;
      other.previous = other.point;
    }
    touch.phase = phase;
    touch.previous = touch.point;
    touch.point = sample.point;
    touch.time = sample.time;
    const changed = collections.collection("NSSet", [touch.ptr]);
    const all = collections.collection(
      "NSSet",
      [...state.active.values()].map((value) => value.ptr),
    );
    const event = alloc(classPointer(names, "UIEvent"));
    state.eventTouches.set(event, all);
    try {
      state.inputMetrics.dispatch(
        className(target),
        sample.type,
        sample.point,
        geo.convertPoint(sample.point, state.window, target),
      );
      await send(target, selector, [changed, event]);
    } finally {
      await releaseFromHost(changed);
      await releaseFromHost(all);
      await releaseFromHost(event);
    }
  };
}

function createSampler(ctx: UiContext, deliver: ReturnType<typeof createDelivery>) {
  const { state, geo, className, services } = ctx;
  return async (
    touch: TouchRecord,
    sample: PointerSample,
    phase: number,
    selector: string,
  ): Promise<void> => {
    const interaction = services.scrollers.get().interaction;
    let pan = { view: 0, cancel: false };
    if (sample.type === PointerPhase.Move) {
      pan = await interaction.move(sample.id, toPoint(sample.point), sample.time);
    }
    if (phase >= TouchPhase.Ended) {
      pan.view = await interaction.end(sample.id, phase === TouchPhase.Cancelled, sample.time);
    }
    if (pan.cancel) {
      if (!touch.deferred) {
        state.inputMetrics.receive();
        await deliver(
          touch,
          { ...sample, type: PointerPhase.Cancel },
          TouchPhase.Cancelled,
          CANCELLED_SELECTOR,
        );
      } else {
        state.inputMetrics.dispatch(
          className(pan.view),
          touch.down.type,
          touch.down.point,
          geo.convertPoint(touch.down.point, state.window, pan.view),
        );
      }
      touch.deferred = false;
      touch.pan = true;
    }
    if (touch.pan || pan.view) {
      const view = pan.view || touch.panView || 0;
      state.inputMetrics.dispatch(
        className(view),
        sample.type,
        sample.point,
        geo.convertPoint(sample.point, state.window, view),
      );
      touch.panView = view;
      touch.point = sample.point;
      touch.phase = phase;
      touch.time = sample.time;
      return;
    }
    if (touch.deferred && phase === TouchPhase.Cancelled) return;
    const held = (sample.time - touch.down.time) * MILLISECONDS_PER_SECOND;
    if (touch.deferred && (phase === TouchPhase.Ended || held >= ScrollTiming.Delay)) {
      touch.deferred = false;
      await deliver(touch, touch.down, TouchPhase.Began, BEGAN_SELECTOR);
    }
    if (!touch.deferred) await deliver(touch, sample, phase, selector);
  };
}

function isDoubleTap(ctx: UiContext, target: number, sample: PointerSample): boolean {
  const previous = ctx.state.previousTap;
  return (
    !!previous &&
    previous.target === target &&
    sample.time - previous.time < DOUBLE_TAP_SECONDS &&
    Math.hypot(sample.point[0] - previous.point[0], sample.point[1] - previous.point[1]) <
      DOUBLE_TAP_DISTANCE
  );
}

function createStarter(ctx: UiContext, hit: Hit) {
  const { state, kit, services, alloc, names, retain, className } = ctx;
  return async (event: PointerSample): Promise<TouchRecord | undefined> => {
    const { inputMetrics } = state;
    if (state.active.has(event.id)) {
      inputMetrics.drop(DropReason.Duplicate);
      return undefined;
    }
    const target = hit(state.window, event.point[0], event.point[1]);
    if (!target) {
      inputMetrics.drop(DropReason.NoTarget);
      return undefined;
    }
    const layer = kit.data(target).layer;
    if (!ctx.glPresented() && layer && className(layer) === GL_LAYER_CLASS) {
      inputMetrics.drop(DropReason.Undrawn);
      return undefined;
    }
    const conflict = touchConflict(
      kit.data,
      target,
      [...state.active.values()].map((touch) => touch.target),
    );
    if (conflict) {
      inputMetrics.drop(conflict);
      return undefined;
    }
    const taps = isDoubleTap(ctx, target, event) ? (state.previousTap?.taps ?? 0) + 1 : 1;
    const touch: TouchRecord = {
      ptr: alloc(classPointer(names, "UITouch")),
      window: state.window,
      target: retain(target),
      taps,
      point: event.point,
      down: event,
      deferred: await services.scrollers
        .get()
        .interaction.begin(event.id, target, toPoint(event.point), event.time),
      phase: TouchPhase.Began,
      previous: event.point,
      time: event.time,
    };
    state.active.set(event.id, touch);
    state.touches.set(touch.ptr, touch);
    return touch;
  };
}

function createFinisher(ctx: UiContext) {
  const { state, releaseFromHost } = ctx;
  return async (event: PointerSample, touch: TouchRecord, phase: number): Promise<void> => {
    if (phase < TouchPhase.Ended) return;
    if (phase === TouchPhase.Ended && !touch.pan) {
      const point: PointLike = touch.point;
      state.previousTap = { target: touch.target, taps: touch.taps, time: touch.time, point };
    }
    state.active.delete(event.id);
    await releaseFromHost(touch.ptr);
    await releaseFromHost(touch.target);
  };
}

function createFrame(ctx: UiContext, layout: Layout) {
  const { state, services } = ctx;
  return async (): Promise<void> => {
    await services.animationGroups.get().pump();
    await services.basicAnimations.get().pump();
    await services.scrollers.get().pump();
    if (state.window) await layout(state.window);
    await services.imageViews.get().render(state.window);
    await services.textFields.get().pump();
    services.webViews.get().render();
  };
}

export function createDispatcher(ctx: UiContext, hit: Hit, layout: Layout) {
  const { state, services } = ctx;
  const deliver = createDelivery(ctx);
  const sample = createSampler(ctx, deliver);
  const begin = createStarter(ctx, hit);
  const finish = createFinisher(ctx);
  const frame = createFrame(ctx, layout);
  const pump = async (): Promise<void> => {
    await frame();
    for (const event of state.queue.takeTurn()) {
      let touch = state.active.get(event.id);
      if (event.type === PointerPhase.Down) {
        touch = await begin(event);
        if (!touch) continue;
      }
      if (!touch) {
        state.inputMetrics.drop(DropReason.Missing);
        continue;
      }
      const [phase, selector] = POINTER_PHASES[event.type];
      try {
        await sample(touch, event, phase, selector);
      } finally {
        await finish(event, touch, phase);
      }
    }
    services.transactions.get().flush();
    for (const touch of state.active.values()) {
      const elapsed = ctx.helpers.now() / MILLISECONDS_PER_SECOND - touch.down.time;
      if (touch.deferred && elapsed * MILLISECONDS_PER_SECOND >= ScrollTiming.Delay) {
        touch.deferred = false;
        await deliver(touch, touch.down, TouchPhase.Began, BEGAN_SELECTOR);
      }
    }
  };
  const cancelTouches = async (): Promise<void> => {
    const discarded = state.queue.clear();
    for (let index = 0; index < discarded; index++) state.inputMetrics.drop(DropReason.Inactive);
    for (const [id, touch] of state.active) {
      state.inputMetrics.receive();
      state.queue.push({
        id,
        type: PointerPhase.Cancel,
        point: touch.point,
        time: ctx.helpers.now() / MILLISECONDS_PER_SECOND,
      });
    }
    if (state.queue.length) await pump();
  };
  return { pump, cancelTouches };
}
