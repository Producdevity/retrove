import type { Inode, PathEntry } from "../../../storage/records";
import type { SaveStores } from "../../../storage/stores";

export async function storedInode(inodes: SaveStores["inodes"], id: number): Promise<Inode> {
  const node = await inodes.get(id);
  if (!node) throw new Error("Guest inode is missing.");
  return node;
}

export function entryInode(item: PathEntry): number {
  if (item.inode === undefined) throw new Error("Guest file has no inode.");
  return item.inode;
}
