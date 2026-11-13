import { applicationId, isPlatform, type ApplicationMetadata } from "../../../domain/application";
import { isRecord, nonnegativeInteger, requiredString } from "../../../domain/validation";
import { inode, inodeKey, pathEntry, pathKey, type Inode, type PathEntry } from "../records";
export const BACKUP_MANIFEST = "retrove.json";
const BACKUP_FORMAT = "retrove.saves";
const BACKUP_VERSION = 1;
export const MAX_MANIFEST_BYTES = 16_777_216;
export interface SavedPath {
  readonly path: string;
  readonly entry: PathEntry;
}
export interface SavedNode {
  readonly id: number;
  readonly node: Inode;
  readonly data: string | null;
}
export interface SaveManifest {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_VERSION;
  readonly app: Pick<ApplicationMetadata, "platform" | "bundleId" | "name" | "version">;
  readonly exportedAt: number;
  readonly paths: readonly SavedPath[];
  readonly nodes: readonly SavedNode[];
}
function savedPath(value: unknown): SavedPath {
  if (!isRecord(value)) throw new Error("Invalid backup file entry.");
  return { path: pathKey(value.path), entry: pathEntry(value.entry) };
}
function savedNode(value: unknown): SavedNode {
  if (!isRecord(value)) throw new Error("Invalid backup inode.");
  const node = inode(value.node);
  if (!node.linked || node.refs) throw new Error("Backup contains live or unlinked files.");
  const data = value.data === null ? null : pathKey(value.data);
  if (node.dir ? data !== null : data === null || !data.startsWith("data/"))
    throw new Error("Invalid backup file contents path.");
  return { id: inodeKey(value.id), node, data };
}
function verifyTree(paths: readonly SavedPath[], nodes: readonly SavedNode[]): void {
  const directory = new Map(paths.map(({ path, entry }) => [path, entry]));
  const index = new Map(nodes.map((entry) => [entry.id, entry]));
  if (directory.size !== paths.length || index.size !== nodes.length)
    throw new Error("Duplicate backup file identity.");
  const linked = new Set<number>(),
    data = new Set<string>();
  for (const { path, entry } of paths) {
    const slash = path.lastIndexOf("/");
    if (slash >= 0 && !directory.get(path.slice(0, slash))?.dir)
      throw new Error("Backup file has no parent directory.");
    if (entry.inode !== undefined) {
      const item = index.get(entry.inode);
      if (!item || !!item.node.dir !== !!entry.dir)
        throw new Error("Backup file points to a missing or incompatible inode.");
      linked.add(entry.inode);
    }
  }
  for (const { id, data: name } of nodes) {
    if (!linked.has(id)) throw new Error("Backup contains an orphan inode.");
    if (name !== null) {
      if (data.has(name)) throw new Error("Backup contents are shared by distinct inodes.");
      data.add(name);
    }
  }
}
export function parseManifest(value: unknown): SaveManifest {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION)
    throw new Error("This is not a supported Retrove save backup.");
  const app = value.app;
  if (!isRecord(app) || !isPlatform(app.platform)) throw new Error("Invalid backup app identity.");
  const identity = {
    platform: app.platform,
    bundleId: requiredString(app.bundleId, "backup bundle identifier"),
    name: requiredString(app.name, "backup app name"),
    version: requiredString(app.version, "backup app version"),
  };
  applicationId(identity.platform, identity.bundleId);
  if (!Array.isArray(value.paths) || !Array.isArray(value.nodes))
    throw new Error("Invalid backup file index.");
  const paths = value.paths.map(savedPath),
    nodes = value.nodes.map(savedNode);
  verifyTree(paths, nodes);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: identity,
    exportedAt: nonnegativeInteger(value.exportedAt, "backup date"),
    paths,
    nodes,
  };
}
export function createManifest(
  app: ApplicationMetadata,
  paths: readonly SavedPath[],
  nodes: readonly SavedNode[],
): SaveManifest {
  return parseManifest({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: { platform: app.platform, bundleId: app.bundleId, name: app.name, version: app.version },
    exportedAt: Date.now(),
    paths,
    nodes,
  });
}
