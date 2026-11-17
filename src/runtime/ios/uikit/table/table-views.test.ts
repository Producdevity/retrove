import { expect, test } from "vite-plus/test";
import type { IndexPaths } from "../../foundation/index-paths";
import { ScrollViews, type ScrollHost, type ScrollViewState } from "../scroll/state";
import { Cells } from "./cells";
import type { TableHost } from "./host";
import { TableSelection } from "./selection";
import { TableViews } from "./table-views";

const TABLE = 100,
  SOURCE = 200;

function fixture() {
  const data = { rows: 20 };
  const views = new Map<number, ScrollViewState>(),
    parents = new Map<number, number>(),
    indexes = new Map<number, readonly number[]>(),
    calls: string[] = [];
  let next = 1000,
    tables: TableViews | undefined;
  const view = (pointer: number): ScrollViewState => {
    let state = views.get(pointer);
    if (!state) {
      state = {
        frame: [0, 0, 0, 0],
        bounds: [0, 0, 0, 0],
        interactive: true,
        needsDisplay: false,
        needsLayout: false,
        clipsToBounds: 0,
      };
      views.set(pointer, state);
    }
    return state;
  };
  const sourceSelectors = new Set([
    "tableView:numberOfRowsInSection:",
    "tableView:cellForRowAtIndexPath:",
  ]);
  const host: TableHost & ScrollHost = {
    hostClass: () => 0,
    method: () => {},
    structure: () => {},
    alloc: () => next++,
    destroy: () => {},
    retain: (value) => value,
    release: async () => {},
    autorelease: (value) => value,
    text: () => "cell",
    string: () => 0,
    write: () => {},
    read: () => 0,
    view,
    setFrame: (self, frame) => {
      view(self).frame = frame;
      view(self).bounds = [0, 0, frame[2], frame[3]];
      return self;
    },
    deallocateView: async () => {},
    ipa: {
      info: {},
      bundlePath: "Payload/Test.app",
      has: () => false,
      read: async () => new Uint8Array(),
    },
    send: async (self, selector, args = []) => {
      calls.push(selector);
      if (selector === "tableView:numberOfRowsInSection:") return data.rows;
      if (selector === "tableView:cellForRowAtIndexPath:") {
        const reused = await tables?.dequeue(TABLE, "cell");
        if (reused) return reused;
        const cell = next++;
        tables?.cells.get(cell);
        if (tables) tables.cells.get(cell).reuse = "cell";
        return cell;
      }
      if (selector === "addSubview:") parents.set(args[0] ?? 0, self);
      if (selector === "removeFromSuperview") parents.delete(self);
      return 0;
    },
    classNamed: () => 0,
    responds: (pointer, selector) => pointer === SOURCE && sourceSelectors.has(selector),
    parent: (pointer) => parents.get(pointer) ?? 0,
    children: () => [],
    hasBackground: () => false,
    touchPoint: () => [10, 50],
    rgba: () => undefined,
    imageSize: () => [0, 0],
    viewImage: () => 0,
    array: () => 0,
    screenSize: () => [320, 480],
    decodeView: async (self) => self,
    local: (_self, point) => point,
    now: () => 0,
    boundsChanged: () => {},
    isControl: () => false,
  };
  const paths: IndexPaths = {
    create: (values) => {
      const pointer = next++;
      indexes.set(pointer, values);
      return pointer;
    },
    indexes: (pointer) => indexes.get(pointer),
  };
  const scrolls = new ScrollViews(host);
  tables = new TableViews(host, new Cells(host), paths, scrolls);
  tables.get(TABLE).dataSource = SOURCE;
  host.setFrame(TABLE, [0, 0, 320, 100]);
  return { tables, scrolls, parents, calls, view, data };
}

test("tiling creates cells for visible rows and reuses cells that scroll away", async () => {
  const x = fixture();
  await x.tables.tile(TABLE);
  const state = x.tables.get(TABLE),
    first = [...state.visible.values()];
  expect([...state.visible.keys()]).toEqual(["0:0", "0:1", "0:2"]);
  expect(first.map((cell) => x.parents.get(cell))).toEqual([TABLE, TABLE, TABLE]);
  expect(x.scrolls.get(TABLE).size).toEqual([320, 880]);
  expect(x.view(first[1] ?? 0).frame).toEqual([0, 44, 320, 44]);
  await x.scrolls.move(TABLE, [0, 200]);
  await x.tables.tile(TABLE);
  expect([...state.visible.keys()]).toEqual(["0:4", "0:5", "0:6"]);
  expect(new Set(state.visible.values())).toEqual(new Set(first));
  expect(state.reuse.get("cell")).toEqual([]);
});
test("reloading clamps the offset when rows disappear", async () => {
  const x = fixture();
  await x.tables.tile(TABLE);
  await x.scrolls.move(TABLE, [0, 500]);
  x.data.rows = 3;
  await x.tables.reload(TABLE);
  expect(x.scrolls.offset(TABLE)).toEqual([0, 32]);
});
test("a tap selects the row under the finger and a second row replaces it", async () => {
  const x = fixture(),
    selection = new TableSelection(x.tables);
  await x.tables.tile(TABLE);
  await selection.began(TABLE, 1);
  expect(x.tables.get(TABLE).pressed).toEqual([0, 1]);
  await selection.ended(TABLE, 1);
  expect(x.tables.get(TABLE).selected).toEqual([0, 1]);
  expect(x.calls.filter((name) => name.startsWith("set"))).toEqual([
    "setHighlighted:animated:",
    "setHighlighted:animated:",
    "setSelected:animated:",
  ]);
  await selection.select(TABLE, [0, 2]);
  expect(x.tables.get(TABLE).selected).toEqual([0, 2]);
});
