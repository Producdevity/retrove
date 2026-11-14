import type { FoundationHost } from "../../objc/host";
interface HierarchyHost extends Pick<FoundationHost, "method"> {
  children(pointer: number): number[];
}
export function installViewOrdering(host: HierarchyHost): void {
  for (const [selector, front] of [
    ["bringSubviewToFront:", true],
    ["sendSubviewToBack:", false],
  ] as const)
    host.method("UIView", false, selector, (self, args) => {
      const children = host.children(self),
        child = args(0),
        index = children.indexOf(child);
      if (index < 0) return;
      children.splice(index, 1);
      if (front) children.push(child);
      else children.unshift(child);
    });
}
