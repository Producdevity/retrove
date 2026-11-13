import { requestResult, transaction } from "../../storage/database";
import { homeDirectories, SaveStore } from "./records";
import { saveStores, type SaveStores } from "./stores";
const DATABASE_PREFIX = "ios-runtime.files:";
const DATABASE_VERSION = 1;
const LEASE_PREFIX = "ios-runtime.open-files:";
interface Environment {
  readonly factory: IDBFactory;
  readonly locks: LockManager | null;
  readonly range: Pick<typeof IDBKeyRange, "bound">;
}
export class SaveStorage {
  private connection: Promise<IDBDatabase> | undefined;
  private releaseLease: (() => void) | undefined;
  private lease: Promise<void> | undefined;
  constructor(
    readonly namespace: string,
    private readonly suppliedEnvironment?: Environment,
  ) {}
  private get environment(): Environment {
    return (
      this.suppliedEnvironment ?? {
        factory: indexedDB,
        locks: globalThis.navigator?.locks ?? null,
        range: IDBKeyRange,
      }
    );
  }
  async database(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    const open = this.environment.factory.open(DATABASE_PREFIX + this.namespace, DATABASE_VERSION);
    open.onupgradeneeded = () => {
      const paths = open.result.createObjectStore(SaveStore.Paths);
      open.result.createObjectStore(SaveStore.Inodes, { autoIncrement: true });
      open.result.createObjectStore(SaveStore.Chunks);
      for (const path of homeDirectories) paths.add({ dir: true }, path);
    };
    this.connection = requestResult(open)
      .then(async (db) => {
        db.onversionchange = () => {
          db.close();
          this.releaseLease?.();
          this.connection = undefined;
        };
        try {
          await this.acquireLease(db);
          return db;
        } catch (error) {
          db.close();
          throw error;
        }
      })
      .catch((error: unknown) => {
        this.connection = undefined;
        throw error;
      });
    return this.connection;
  }
  private async acquireLease(db: IDBDatabase): Promise<void> {
    const manager = this.environment.locks;
    if (!manager) return;
    const name = LEASE_PREFIX + this.namespace;
    await manager.request(name, { ifAvailable: true }, async (exclusive) => {
      if (!exclusive) return;
      await this.transact(db, "readwrite", async ({ inodes, chunks }) => {
        for (const id of await inodes.keys()) {
          const node = await inodes.get(id);
          if (!node) throw new Error("Guest inode disappeared during recovery.");
          if (!node.linked) {
            await chunks.deleteInode(id);
            await inodes.delete(id);
          } else if (node.refs) {
            node.refs = 0;
            await inodes.put(id, node);
          }
        }
      });
    });
    await new Promise<void>((ready, failed) => {
      this.lease = manager
        .request(name, { mode: "shared" }, () => {
          const released = new Promise<void>((resolve) => {
            this.releaseLease = resolve;
          });
          ready();
          return released;
        })
        .then(
          () => undefined,
          (error: unknown) => {
            failed(error);
          },
        );
    });
  }
  private transact<T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    operation: (stores: SaveStores) => Promise<T>,
  ): Promise<T> {
    return transaction(db, Object.values(SaveStore), mode, (tx) =>
      operation(saveStores(tx, this.environment.range)),
    );
  }
  async run<T>(
    mode: IDBTransactionMode,
    operation: (stores: SaveStores) => Promise<T>,
  ): Promise<T> {
    return this.transact(await this.database(), mode, operation);
  }
  async close(): Promise<void> {
    try {
      if (this.connection) (await this.connection).close();
    } finally {
      this.connection = undefined;
      this.releaseLease?.();
      await this.lease;
      this.releaseLease = undefined;
      this.lease = undefined;
    }
  }
}
