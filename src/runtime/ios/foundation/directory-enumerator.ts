import { Argument, type FoundationHost, type HostResult } from "../objc/host";

const ENUMERATOR_CLASS = "NSEnumerator";
const DIRECTORY_ENUMERATOR_CLASS = "NSDirectoryEnumerator";
const MANAGER_CLASS = "NSFileManager";
const StateField = { Position: 0, Items: 4, Mutations: 8 } as const;

export interface DirectoryEntry {
  readonly name: string;
  readonly directory: boolean;
}
export interface DirectoryEnumeratorHost extends FoundationHost {
  classNamed(name: string): number;
  send(self: number, selector: string, arguments_?: number[]): Promise<HostResult>;
  /** Entries of a directory other than "." and "..", or undefined when it cannot be opened. */
  list(path: string): Promise<readonly DirectoryEntry[] | undefined>;
}

interface Walk {
  readonly root: string;
  /** Relative paths still to visit, deepest directory first. */
  readonly pending: DirectoryEntry[][];
  /** The directory most recently returned, until its contents are queued. */
  descend: string | undefined;
}

function joined(parent: string, name: string): string {
  return parent ? parent + "/" + name : name;
}

/** NSDirectoryEnumerator: a depth-first, pre-order walk yielding paths relative to its root. */
export function installDirectoryEnumerator(host: DirectoryEnumeratorHost): void {
  host.hostClass(DIRECTORY_ENUMERATOR_CLASS, ENUMERATOR_CLASS);
  const walks = new Map<number, Walk>();
  const relative = (entries: readonly DirectoryEntry[], parent: string) =>
    entries.map((entry) => ({ ...entry, name: joined(parent, entry.name) })).reverse();
  host.method(MANAGER_CLASS, false, "enumeratorAtPath:", async (_, args) => {
    const path = args(Argument.First);
    const root = path ? host.text(path) : "";
    const entries = root ? await host.list(root) : undefined;
    if (!entries) return 0;
    const self = host.alloc(host.classNamed(DIRECTORY_ENUMERATOR_CLASS));
    walks.set(self, { root, pending: [relative(entries, "")], descend: undefined });
    return host.autorelease(self);
  });
  host.method(DIRECTORY_ENUMERATOR_CLASS, false, "nextObject", async (self) => {
    const walk = walks.get(self);
    if (!walk) return 0;
    if (walk.descend !== undefined) {
      const children = await host.list(joined(walk.root, walk.descend));
      if (children?.length) walk.pending.push(relative(children, walk.descend));
      walk.descend = undefined;
    }
    for (let level = walk.pending.at(-1); level; level = walk.pending.at(-1)) {
      const entry = level.pop();
      if (!entry) {
        walk.pending.pop();
        continue;
      }
      if (entry.directory) walk.descend = entry.name;
      return host.autorelease(host.string(entry.name));
    }
    return 0;
  });
  host.method(DIRECTORY_ENUMERATOR_CLASS, false, "skipDescendents", (self) => {
    const walk = walks.get(self);
    if (walk) walk.descend = undefined;
  });
  host.method(DIRECTORY_ENUMERATOR_CLASS, false, "dealloc", (self) => {
    walks.delete(self);
    host.destroy(self);
  });
  installEnumeratorFastEnumeration(host);
}

/** NSEnumerator's fast enumeration hands out one nextObject result per call. */
function installEnumeratorFastEnumeration(host: DirectoryEnumeratorHost): void {
  host.method(
    ENUMERATOR_CLASS,
    false,
    "countByEnumeratingWithState:objects:count:",
    async (self, args) => {
      const state = args(Argument.First),
        buffer = args(Argument.Second);
      if (!args(Argument.Third)) return 0;
      const next = await host.send(self, "nextObject");
      if (typeof next !== "number" || !next) return 0;
      host.write(buffer, next);
      host.write(state + StateField.Position, 1);
      host.write(state + StateField.Items, buffer);
      // The enumerator's own isa never changes, so it serves as the mutation word.
      host.write(state + StateField.Mutations, self);
      return 1;
    },
  );
}
