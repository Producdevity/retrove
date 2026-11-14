import { isRecord, nonnegativeInteger } from "../../domain/validation";
export const SaveStore = { Paths: "paths", Inodes: "inodes", Chunks: "chunks" } as const;
export const SAVE_CHUNK_BYTES = 65_536;
export const homeDirectories = [
  "Documents",
  "Documents/SaveGames",
  "Library",
  "Library/Caches",
  "Library/Application Support",
  "tmp",
];
export interface PathEntry {
  created?: number;
  modified?: number;
  original?: string;
  dir?: boolean;
  inode?: number;
  permissions?: number;
}
export interface Inode {
  dir?: boolean;
  linked: boolean;
  refs: number;
  size?: number;
  permissions?: number;
  created?: number;
  modified?: number;
}
export type ChunkKey = [number, number];
export function inodeKey(value: unknown): number {
  const key = nonnegativeInteger(value, "inode key");
  if (!key) throw new Error("Invalid zero inode key.");
  return key;
}
export function pathKey(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\0") || value.startsWith("/"))
    throw new Error("Invalid guest file path.");
  if (value.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Invalid guest file path segment.");
  return value;
}
export function chunkKey(value: unknown): ChunkKey {
  const CHUNK_KEY_FIELDS = 2;
  if (!Array.isArray(value) || value.length !== CHUNK_KEY_FIELDS)
    throw new Error("Invalid save chunk key.");
  return [inodeKey(value[0]), nonnegativeInteger(value[1], "chunk index")];
}
const MAX_TIMESTAMP = 8_640_000_000_000_000;
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_TIMESTAMP)
    throw new Error("Invalid guest file timestamp.");
  return value;
}
export function pathEntry(value: unknown): PathEntry {
  if (!isRecord(value)) throw new Error("Invalid guest file entry.");
  const entry: PathEntry = {};
  if (value.original !== undefined) entry.original = pathKey(value.original);
  if (value.dir !== undefined) {
    if (typeof value.dir !== "boolean") throw new Error("Invalid guest directory flag.");
    entry.dir = value.dir;
  }
  if (value.inode !== undefined) entry.inode = inodeKey(value.inode);
  if (!entry.dir && entry.inode === undefined) throw new Error("Guest file has no inode.");
  if (value.permissions !== undefined)
    entry.permissions = nonnegativeInteger(value.permissions, "file permissions");
  for (const field of ["created", "modified"] as const)
    if (value[field] !== undefined) entry[field] = timestamp(value[field]);
  return entry;
}
export function inode(value: unknown): Inode {
  if (!isRecord(value) || typeof value.linked !== "boolean")
    throw new Error("Invalid guest inode.");
  const entry: Inode = {
    linked: value.linked,
    refs: nonnegativeInteger(value.refs, "open references"),
  };
  if (value.dir !== undefined) {
    if (typeof value.dir !== "boolean") throw new Error("Invalid inode directory flag.");
    entry.dir = value.dir;
  }
  for (const field of ["size", "permissions"] as const)
    if (value[field] !== undefined) entry[field] = nonnegativeInteger(value[field], field);
  if (!entry.dir && entry.size === undefined) throw new Error("Guest file inode has no size.");
  for (const field of ["created", "modified"] as const)
    if (value[field] !== undefined) entry[field] = timestamp(value[field]);
  return entry;
}
export function chunk(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > SAVE_CHUNK_BYTES)
    throw new Error("Invalid guest save chunk.");
  return value;
}
