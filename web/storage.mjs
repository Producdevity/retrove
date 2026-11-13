// Persist directory names separately from file contents. An open descriptor
// continues to reference its inode when the game renames or unlinks a save.
export const homeDirectories = ["Documents", "Documents/SaveGames", "Library", "Library/Caches", "Library/Application Support", "tmp"];

function request(event) {
  return new Promise((resolve, reject) => {
    event.onsuccess = () => resolve(event.result);
    event.onerror = () => reject(event.error);
  });
}

export class SaveStorage {
  constructor(namespace) { this.namespace = namespace; }
  async acquireLease(db) {
    const manager = globalThis.navigator?.locks;
    if (!manager) return;
    const name = "ios-runtime.open-files:" + this.namespace;
    // Reloading or killing a Worker can skip close(). When no other session
    // holds this bundle, reclaim unlinked files and reset stale open counts.
    await manager.request(name, { ifAvailable: true }, async exclusive => {
      if (!exclusive) return;
      await this.transaction(db, "readwrite", async ({ inodes, chunks }) => {
        for (const id of await inodes.keys()) {
          const node = await inodes.get(id);
          if (!node.linked) { await chunks.deleteInode(id); await inodes.delete(id); }
          else if (node.refs) { node.refs = 0; await inodes.put(id, node); }
        }
      });
    });
    await new Promise((ready, fail) => {
      this.lease = manager.request(name, { mode: "shared" }, () => {
        const released = new Promise(resolve => { this.release = resolve; });
        ready();
        return released;
      }).catch(fail);
    });
  }
  async database() {
    if (!this.connection) {
      this.connection = new Promise((resolve, reject) => {
        const open = indexedDB.open("ios-runtime.files:" + this.namespace, 1);
        open.onupgradeneeded = () => {
          const paths = open.result.createObjectStore("paths");
          open.result.createObjectStore("inodes", { autoIncrement: true });
          open.result.createObjectStore("chunks");
          for (const dir of homeDirectories) paths.add({ dir: true }, dir);
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          db.onversionchange = () => { db.close(); this.connection = null; };
          resolve(db);
        };
      }).then(async db => {
        try { await this.acquireLease(db); return db; }
        catch (error) { db.close(); throw error; }
      }).catch(error => { this.connection = null; throw error; });
    }
    return this.connection;
  }
  async run(mode, action) {
    return this.transaction(await this.database(), mode, action);
  }
  async transaction(db, mode, action) {
    const tx = db.transaction(["paths", "inodes", "chunks"], mode);
    const finished = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || Error("Save transaction aborted"));
    });
    const stores = {};
    for (const name of ["paths", "inodes", "chunks"]) {
      const st = tx.objectStore(name);
      stores[name] = {
        get: key => request(st.get(key)), keys: () => request(st.getAllKeys()),
        put: (key, value) => request(st.put(value, key)), add: value => request(st.add(value)),
        delete: key => request(st.delete(key)),
        deleteInode: id => request(st.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])))
      };
    }
    try {
      const result = await action(stores);
      await finished;
      return result;
    } catch (error) {
      try { tx.abort(); } catch {}
      await finished.catch(() => {});
      throw error;
    }
  }
  async close() {
    try { if (this.connection) (await this.connection).close(); }
    finally {
      this.connection = null;
      this.release?.();
      await this.lease;
      this.release = null;
      this.lease = null;
    }
  }
}
