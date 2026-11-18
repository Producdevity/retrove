import { expect, test } from "vite-plus/test";
import { ArchiveGraph, ArchiveReference, CUSTOM_OBJECT_KEY } from "./graph";

function archive(link: ArchiveReference) {
  return {
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $top: { root: new ArchiveReference(1) },
    $objects: ["$null", { $class: new ArchiveReference(2), link }, { $classname: "Node" }],
  };
}
test("cyclic guest graphs reuse the allocated object before initialization completes", async () => {
  const allocations: string[] = [],
    releases: number[] = [];
  let linked = 0;
  const graph = new ArchiveGraph(archive(new ArchiveReference(1)), {
    scalar: () => {
      throw Error("Unexpected scalar");
    },
    allocate: (name) => {
      allocations.push(name);
      return 123;
    },
    hasClass: () => true,
    initialize: async (pointer, name, fields) => {
      expect(name).toBe("Node");
      linked = await graph.decode(fields.link);
      return pointer;
    },
    release: async (pointer) => {
      releases.push(pointer);
    },
  });
  expect(await graph.decode(graph.top.root)).toBe(123);
  expect(linked).toBe(123);
  expect(allocations).toEqual(["Node"]);
  await graph.dispose();
  expect(releases).toEqual([123]);
});
test("invalid references fail the decoder without exposing half-initialized objects", async () => {
  const graph = new ArchiveGraph(archive(new ArchiveReference(99)), {
    scalar: () => 1,
    allocate: () => 123,
    hasClass: () => true,
    initialize: async (_, __, fields) => graph.decode(fields.link),
    release: async () => {},
  });
  await expect(graph.decode(graph.top.root)).rejects.toThrow("reference");
  await expect(graph.decode(graph.top.root)).rejects.toThrow("decoding has failed");
});
test("class swappers decode as the custom class, or the original one when it is missing", async () => {
  const swapper = (custom: string, original: string) => ({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $top: { root: new ArchiveReference(1) },
    $objects: [
      "$null",
      {
        $class: new ArchiveReference(2),
        UIClassName: new ArchiveReference(3),
        UIOriginalClassName: new ArchiveReference(4),
      },
      { $classname: "UIClassSwapper" },
      custom,
      original,
    ],
  });
  const decoded = async (custom: string, original: string) => {
    let seen: [string, unknown] = ["", undefined];
    const graph = new ArchiveGraph(swapper(custom, original), {
      scalar: () => 1,
      allocate: () => 7,
      hasClass: (name) => name !== "Missing",
      initialize: async (pointer, name, fields) => {
        seen = [name, fields[CUSTOM_OBJECT_KEY]];
        return pointer;
      },
      release: async () => {},
    });
    await graph.decode(graph.top.root);
    return seen;
  };
  expect(await decoded("GameView", "UIView")).toEqual(["GameView", undefined]);
  expect(await decoded("Missing", "UIView")).toEqual(["UIView", undefined]);
  expect(await decoded("AppDelegate", "UICustomObject")).toEqual(["AppDelegate", true]);
});
