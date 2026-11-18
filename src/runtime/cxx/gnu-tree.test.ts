import { describe, expect, it } from "vite-plus/test";
import { gnuContainerImports, RedBlackTree } from "./gnu-tree";

const NODE_BYTES = 16;
function memory() {
  const words = new Map<number, number>();
  return {
    read: (pointer: number) => words.get(pointer) ?? 0,
    write: (pointer: number, value: number) => void words.set(pointer, value),
  };
}
/** A std::set<int> built on the host tree: nodes carry their key after the 16-byte base. */
function set() {
  const words = memory();
  const tree = new RedBlackTree(words);
  const header = 0x1000;
  words.write(header + 8, header);
  words.write(header + 12, header);
  let next = 0x2000;
  const key = (node: number) => words.read(node + NODE_BYTES);
  const insert = (value: number) => {
    let parent = header,
      node = words.read(header + 4),
      left = true;
    while (node) {
      parent = node;
      left = value < key(node);
      node = words.read(node + (left ? 8 : 12));
    }
    const created = (next += 0x20);
    words.write(created + NODE_BYTES, value);
    tree.insertAndRebalance(left, created, parent, header);
    return created;
  };
  const values = () => {
    const out: number[] = [];
    for (let node = words.read(header + 8); node !== header; node = tree.increment(node))
      out.push(key(node));
    return out;
  };
  const backwards = () => {
    const out: number[] = [];
    for (let node = tree.decrement(header); node !== header; node = tree.decrement(node)) {
      out.push(key(node));
      if (node === words.read(header + 8)) break;
    }
    return out;
  };
  /** Every path from the root has the same black count and no red node has a red child. */
  const valid = (node = words.read(header + 4)): number => {
    if (!node) return 1;
    const red = words.read(node) === 0;
    for (const side of [8, 12]) {
      const child = words.read(node + side);
      if (red && child && words.read(child) === 0) throw new Error("red child of red node");
      if (child && words.read(child + 4) !== node) throw new Error("broken parent link");
    }
    const left = valid(words.read(node + 8)),
      right = valid(words.read(node + 12));
    if (left !== right) throw new Error("unbalanced black height");
    return left + (red ? 0 : 1);
  };
  return { words, tree, header, insert, values, backwards, valid };
}

describe("GNU red-black tree", () => {
  it("keeps keys ordered and balanced through inserts and erases", () => {
    const { words, tree, header, insert, values, backwards, valid } = set();
    const keys = Array.from({ length: 200 }, (_, index) => (index * 7919) % 211);
    const nodes = new Map(keys.map((value) => [value, insert(value)]));
    expect(values()).toEqual([...keys].sort((a, b) => a - b));
    expect(backwards()).toEqual([...keys].sort((a, b) => b - a));
    expect(valid()).toBeGreaterThan(0);
    const removed = keys.filter((value) => value % 3 === 0);
    for (const value of removed) {
      const node = nodes.get(value) ?? 0;
      expect(tree.rebalanceForErase(node, header)).toBe(node);
      valid();
    }
    const left = keys.filter((value) => value % 3 !== 0).sort((a, b) => a - b);
    expect(values()).toEqual(left);
    expect(words.read(words.read(header + 8) + NODE_BYTES)).toBe(left[0]);
    expect(words.read(words.read(header + 12) + NODE_BYTES)).toBe(left.at(-1));
  });
  it("links, moves and reverses list nodes", () => {
    const words = memory();
    const imports = gnuContainerImports(words);
    const call = (name: string, ...values: number[]) => imports[name]?.((i) => values[i] ?? 0);
    const head = 0x100;
    words.write(head, head);
    words.write(head + 4, head);
    for (const node of [0x200, 0x300, 0x400]) call("__ZNSt15_List_node_base4hookEPS_", node, head);
    const order = () => {
      const out: number[] = [];
      for (let node = words.read(head); node !== head; node = words.read(node)) out.push(node);
      return out;
    };
    expect(order()).toEqual([0x200, 0x300, 0x400]);
    call("__ZNSt15_List_node_base7reverseEv", head);
    expect(order()).toEqual([0x400, 0x300, 0x200]);
    call("__ZNSt15_List_node_base8transferEPS_S0_", 0x400, 0x300, head);
    expect(order()).toEqual([0x300, 0x200, 0x400]);
    call("__ZNSt15_List_node_base6unhookEv", 0x200);
    expect(order()).toEqual([0x300, 0x400]);
  });
});
