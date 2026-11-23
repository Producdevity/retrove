import type { TouchContext } from "./context";
import type { Matrix, Rect } from "./view-data";

const MAX_SCENE_NODES = 12;

export interface SceneNode {
  class: string;
  controller: string | undefined;
  rootController: string | undefined;
  frame: Rect;
  bounds: Rect;
  transform: Matrix;
  hidden: boolean;
}

export function describeScene(
  ctx: TouchContext,
  className: (pointer: number) => string,
): SceneNode[] {
  const { state, kit } = ctx;
  const nodes: SceneNode[] = [];
  const pending = state.window ? [state.window] : [];
  while (pending.length && nodes.length < MAX_SCENE_NODES) {
    const pointer = pending.shift();
    if (pointer === undefined) break;
    const view = kit.data(pointer);
    nodes.push({
      class: className(pointer),
      controller: view.controller ? className(view.controller) : undefined,
      rootController: view.rootController ? className(view.rootController) : undefined,
      frame: [...view.frame],
      bounds: [...view.bounds],
      transform: [...view.transform],
      hidden: view.hidden,
    });
    pending.push(...view.children.slice(0, MAX_SCENE_NODES));
  }
  return nodes;
}
