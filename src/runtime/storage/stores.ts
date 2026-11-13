import { requestResult } from "../../storage/database";
import {
  SaveStore,
  chunk,
  chunkKey,
  inode,
  inodeKey,
  pathEntry,
  pathKey,
  type ChunkKey,
  type Inode,
  type PathEntry,
} from "./records";
export interface Store<Key extends IDBValidKey, Value> {
  get(key: Key): Promise<Value | undefined>;
  keys(): Promise<Key[]>;
  put(key: Key, value: Value): Promise<void>;
  delete(key: Key): Promise<void>;
}
export interface SaveStores {
  paths: Store<string, PathEntry>;
  inodes: Store<number, Inode> & { add(value: Inode): Promise<number> };
  chunks: Store<ChunkKey, Uint8Array> & { deleteInode(id: number): Promise<void> };
}
function store<Key extends IDBValidKey, Value>(
  objectStore: IDBObjectStore,
  decodeKey: (value: unknown) => Key,
  decode: (value: unknown) => Value,
): Store<Key, Value> {
  return {
    async get(key) {
      const value: unknown = await requestResult(objectStore.get(decodeKey(key)));
      return value === undefined ? undefined : decode(value);
    },
    async keys() {
      const keys: unknown = await requestResult(objectStore.getAllKeys());
      if (!Array.isArray(keys)) throw new Error("Invalid save directory index.");
      return keys.map(decodeKey);
    },
    async put(key, value) {
      await requestResult(objectStore.put(decode(value), decodeKey(key)));
    },
    async delete(key) {
      await requestResult(objectStore.delete(decodeKey(key)));
    },
  };
}
export function saveStores(
  tx: IDBTransaction,
  range: Pick<typeof IDBKeyRange, "bound">,
): SaveStores {
  const inodes = tx.objectStore(SaveStore.Inodes),
    chunks = tx.objectStore(SaveStore.Chunks);
  return {
    paths: store(tx.objectStore(SaveStore.Paths), pathKey, pathEntry),
    inodes: {
      ...store(inodes, inodeKey, inode),
      async add(value) {
        return inodeKey(await requestResult(inodes.add(inode(value))));
      },
    },
    chunks: {
      ...store(chunks, chunkKey, chunk),
      async deleteInode(id) {
        const key = inodeKey(id);
        await requestResult(chunks.delete(range.bound([key, 0], [key, Number.MAX_SAFE_INTEGER])));
      },
    },
  };
}
