import type { GuestArguments } from "../ios/objc/host";

/** GNU libstdc++ _Rb_tree_node_base on 32-bit ARM: color, parent, left, right. */
const Node = { Color: 0, Parent: 4, Left: 8, Right: 12 } as const;
const Color = { Red: 0, Black: 1 } as const;
/** _List_node_base: next, prev. */
const ListNode = { Next: 0, Prev: 4 } as const;
const Arg = { First: 0, Second: 1, Third: 2, Fourth: 3 } as const;
/** C++ bool arguments arrive in the low byte of a register. */
const BOOL_MASK = 0xff;

export interface WordMemory {
  read(pointer: number): number;
  write(pointer: number, value: number): void;
}
type Imports = Record<string, (args: GuestArguments) => number | void>;
type Side = typeof Node.Left | typeof Node.Right;
const other = (side: Side): Side => (side === Node.Left ? Node.Right : Node.Left);

/** The out-of-line red-black tree algorithms behind std::map and std::set in GNU libstdc++. */
export class RedBlackTree {
  constructor(private readonly memory: WordMemory) {}
  private get(node: number, field: number): number {
    return this.memory.read(node + field);
  }
  private set(node: number, field: number, value: number): void {
    this.memory.write(node + field, value);
  }
  private isRed(node: number): boolean {
    return node !== 0 && this.get(node, Node.Color) === Color.Red;
  }
  private extreme(node: number, side: Side): number {
    let current = node;
    while (this.get(current, side)) current = this.get(current, side);
    return current;
  }
  increment(start: number): number {
    let node = start;
    if (this.get(node, Node.Right)) return this.extreme(this.get(node, Node.Right), Node.Left);
    let parent = this.get(node, Node.Parent);
    while (node === this.get(parent, Node.Right)) {
      node = parent;
      parent = this.get(parent, Node.Parent);
    }
    return this.get(node, Node.Right) === parent ? node : parent;
  }
  decrement(start: number): number {
    let node = start;
    if (this.isRed(node) && this.get(this.get(node, Node.Parent), Node.Parent) === node)
      return this.get(node, Node.Right);
    if (this.get(node, Node.Left)) return this.extreme(this.get(node, Node.Left), Node.Right);
    let parent = this.get(node, Node.Parent);
    while (node === this.get(parent, Node.Left)) {
      node = parent;
      parent = this.get(parent, Node.Parent);
    }
    return parent;
  }
  /** Rotates `node` towards `side`; `rootSlot` holds the tree's root pointer. */
  rotate(node: number, side: Side, rootSlot: number): void {
    const away = other(side);
    const child = this.get(node, away);
    const inner = this.get(child, side);
    this.set(node, away, inner);
    if (inner) this.set(inner, Node.Parent, node);
    const parent = this.get(node, Node.Parent);
    this.set(child, Node.Parent, parent);
    if (node === this.memory.read(rootSlot)) this.memory.write(rootSlot, child);
    else if (node === this.get(parent, Node.Left)) this.set(parent, Node.Left, child);
    else this.set(parent, Node.Right, child);
    this.set(child, side, node);
    this.set(node, Node.Parent, child);
  }
  insertAndRebalance(insertLeft: boolean, inserted: number, parent: number, header: number): void {
    const rootSlot = header + Node.Parent;
    this.set(inserted, Node.Parent, parent);
    this.set(inserted, Node.Left, 0);
    this.set(inserted, Node.Right, 0);
    this.set(inserted, Node.Color, Color.Red);
    if (insertLeft) {
      this.set(parent, Node.Left, inserted);
      if (parent === header) {
        this.set(header, Node.Parent, inserted);
        this.set(header, Node.Right, inserted);
      } else if (parent === this.get(header, Node.Left)) this.set(header, Node.Left, inserted);
    } else {
      this.set(parent, Node.Right, inserted);
      if (parent === this.get(header, Node.Right)) this.set(header, Node.Right, inserted);
    }
    let node = inserted;
    while (node !== this.memory.read(rootSlot) && this.isRed(this.get(node, Node.Parent))) {
      const up = this.get(node, Node.Parent),
        grand = this.get(up, Node.Parent);
      const side: Side = up === this.get(grand, Node.Left) ? Node.Left : Node.Right;
      const uncle = this.get(grand, other(side));
      if (this.isRed(uncle)) {
        this.set(up, Node.Color, Color.Black);
        this.set(uncle, Node.Color, Color.Black);
        this.set(grand, Node.Color, Color.Red);
        node = grand;
        continue;
      }
      if (node === this.get(up, other(side))) {
        node = up;
        this.rotate(node, side, rootSlot);
      }
      this.set(this.get(node, Node.Parent), Node.Color, Color.Black);
      this.set(grand, Node.Color, Color.Red);
      this.rotate(grand, other(side), rootSlot);
    }
    this.set(this.memory.read(rootSlot), Node.Color, Color.Black);
  }
  /** Unlinks `target` and rebalances; returns the node the caller frees. */
  rebalanceForErase(target: number, header: number): number {
    const rootSlot = header + Node.Parent;
    const { child, childParent, removed } = this.unlink(target, header, rootSlot);
    if (this.get(removed, Node.Color) !== Color.Red) this.fixErase(child, childParent, rootSlot);
    return removed;
  }
  private unlink(target: number, header: number, rootSlot: number) {
    const left = this.get(target, Node.Left),
      right = this.get(target, Node.Right);
    const successor = left && right ? this.extreme(right, Node.Left) : target;
    const child = successor === target ? left || right : this.get(successor, Node.Right);
    const parent = this.get(target, Node.Parent);
    const replaceInParent = (value: number) => {
      if (this.memory.read(rootSlot) === target) this.memory.write(rootSlot, value);
      else if (this.get(parent, Node.Left) === target) this.set(parent, Node.Left, value);
      else this.set(parent, Node.Right, value);
    };
    if (successor !== target) {
      this.set(left, Node.Parent, successor);
      this.set(successor, Node.Left, left);
      let childParent = successor;
      if (successor !== right) {
        childParent = this.get(successor, Node.Parent);
        if (child) this.set(child, Node.Parent, childParent);
        this.set(childParent, Node.Left, child);
        this.set(successor, Node.Right, right);
        this.set(right, Node.Parent, successor);
      }
      replaceInParent(successor);
      this.set(successor, Node.Parent, parent);
      const color = this.get(successor, Node.Color);
      this.set(successor, Node.Color, this.get(target, Node.Color));
      this.set(target, Node.Color, color);
      return { child, childParent, removed: target };
    }
    if (child) this.set(child, Node.Parent, parent);
    replaceInParent(child);
    if (this.get(header, Node.Left) === target)
      this.set(header, Node.Left, right ? this.extreme(child, Node.Left) : parent);
    if (this.get(header, Node.Right) === target)
      this.set(header, Node.Right, left ? this.extreme(child, Node.Right) : parent);
    return { child, childParent: parent, removed: target };
  }
  private fixErase(start: number, startParent: number, rootSlot: number): void {
    let node = start,
      parent = startParent;
    while (node !== this.memory.read(rootSlot) && !this.isRed(node)) {
      const side: Side = node === this.get(parent, Node.Left) ? Node.Left : Node.Right;
      const away = other(side);
      let sibling = this.get(parent, away);
      if (this.isRed(sibling)) {
        this.set(sibling, Node.Color, Color.Black);
        this.set(parent, Node.Color, Color.Red);
        this.rotate(parent, side, rootSlot);
        sibling = this.get(parent, away);
      }
      if (!this.isRed(this.get(sibling, side)) && !this.isRed(this.get(sibling, away))) {
        this.set(sibling, Node.Color, Color.Red);
        node = parent;
        parent = this.get(parent, Node.Parent);
        continue;
      }
      if (!this.isRed(this.get(sibling, away))) {
        this.set(this.get(sibling, side), Node.Color, Color.Black);
        this.set(sibling, Node.Color, Color.Red);
        this.rotate(sibling, away, rootSlot);
        sibling = this.get(parent, away);
      }
      this.set(sibling, Node.Color, this.get(parent, Node.Color));
      this.set(parent, Node.Color, Color.Black);
      const far = this.get(sibling, away);
      if (far) this.set(far, Node.Color, Color.Black);
      this.rotate(parent, side, rootSlot);
      break;
    }
    if (node) this.set(node, Node.Color, Color.Black);
  }
  blackCount(start: number, root: number): number {
    let count = 0;
    for (let node = start; node; node = this.get(node, Node.Parent)) {
      if (this.get(node, Node.Color) === Color.Black) count++;
      if (node === root) break;
    }
    return count;
  }
}

function treeImports(tree: RedBlackTree, memory: WordMemory): Imports {
  const imports: Imports = {
    __ZSt29_Rb_tree_insert_and_rebalancebPSt18_Rb_tree_node_baseS0_RS_: (a) =>
      tree.insertAndRebalance(
        (a(Arg.First) & BOOL_MASK) !== 0,
        a(Arg.Second),
        a(Arg.Third),
        a(Arg.Fourth),
      ),
    __ZSt28_Rb_tree_rebalance_for_erasePSt18_Rb_tree_node_baseRS_: (a) =>
      tree.rebalanceForErase(a(Arg.First), a(Arg.Second)),
    __ZSt20_Rb_tree_black_countPKSt18_Rb_tree_node_baseS1_: (a) =>
      tree.blackCount(a(Arg.First), a(Arg.Second)),
    __ZSt20_Rb_tree_rotate_leftPSt18_Rb_tree_node_baseRS0_: (a) =>
      tree.rotate(a(Arg.First), Node.Left, a(Arg.Second)),
    __ZSt21_Rb_tree_rotate_rightPSt18_Rb_tree_node_baseRS0_: (a) =>
      tree.rotate(a(Arg.First), Node.Right, a(Arg.Second)),
  };
  for (const constant of ["", "K"]) {
    imports[`__ZSt18_Rb_tree_incrementP${constant}St18_Rb_tree_node_base`] = (a) =>
      tree.increment(a(Arg.First));
    imports[`__ZSt18_Rb_tree_decrementP${constant}St18_Rb_tree_node_base`] = (a) =>
      tree.decrement(a(Arg.First));
  }
  return { ...imports, ...listImports(memory) };
}

function listImports(memory: WordMemory): Imports {
  const next = (node: number) => memory.read(node + ListNode.Next);
  const prev = (node: number) => memory.read(node + ListNode.Prev);
  const setNext = (node: number, value: number) => memory.write(node + ListNode.Next, value);
  const setPrev = (node: number, value: number) => memory.write(node + ListNode.Prev, value);
  const relink = (node: number) => {
    setPrev(next(node), node);
    setNext(prev(node), node);
  };
  const takeFrom = (target: number, source: number) => {
    setNext(target, next(source));
    setPrev(target, prev(source));
    relink(target);
    setNext(source, source);
    setPrev(source, source);
  };
  return {
    __ZNSt15_List_node_base4hookEPS_: (a) => {
      const node = a(Arg.First),
        position = a(Arg.Second);
      setNext(node, position);
      setPrev(node, prev(position));
      setNext(prev(position), node);
      setPrev(position, node);
    },
    __ZNSt15_List_node_base6unhookEv: (a) => {
      const node = a(Arg.First);
      setNext(prev(node), next(node));
      setPrev(next(node), prev(node));
    },
    __ZNSt15_List_node_base8transferEPS_S0_: (a) => {
      const position = a(Arg.First),
        first = a(Arg.Second),
        last = a(Arg.Third);
      if (position === last) return;
      setNext(prev(last), position);
      setNext(prev(first), last);
      setNext(prev(position), first);
      const before = prev(position);
      setPrev(position, prev(last));
      setPrev(last, prev(first));
      setPrev(first, before);
    },
    __ZNSt15_List_node_base7reverseEv: (a) => {
      const head = a(Arg.First);
      let node = head;
      do {
        const after = next(node);
        setNext(node, prev(node));
        setPrev(node, after);
        node = after;
      } while (node !== head);
    },
    __ZNSt15_List_node_base4swapERS_S0_: (a) => {
      const x = a(Arg.First),
        y = a(Arg.Second);
      const xFull = next(x) !== x,
        yFull = next(y) !== y;
      if (xFull && yFull) {
        const [xn, xp] = [next(x), prev(x)];
        setNext(x, next(y));
        setPrev(x, prev(y));
        setNext(y, xn);
        setPrev(y, xp);
        relink(x);
        relink(y);
      } else if (xFull) takeFrom(y, x);
      else if (yFull) takeFrom(x, y);
    },
  };
}

/** GNU libstdc++ tree and list node helpers used by std::map, std::set and std::list. */
export function gnuContainerImports(memory: WordMemory): Imports {
  return treeImports(new RedBlackTree(memory), memory);
}
