import { describe, expect, test } from "vite-plus/test";
import {
  applicationId,
  ArchiveKind,
  Platform,
  type ApplicationId,
  type ApplicationMetadata,
  type ArchiveReference,
  type InstalledApplication,
} from "../domain/application";
import type { ArchiveRepository, LibraryEnvironment, LibraryRepository } from "./contracts";
import { ApplicationLibrary } from "./service";

class Records implements LibraryRepository {
  readonly data = new Map<ApplicationId, InstalledApplication>();
  rejectWrites = false;
  list(): Promise<InstalledApplication[]> {
    return Promise.resolve([...this.data.values()]);
  }
  get(id: ApplicationId): Promise<InstalledApplication | undefined> {
    return Promise.resolve(this.data.get(id));
  }
  put(app: InstalledApplication): Promise<void> {
    if (this.rejectWrites) return Promise.reject(new Error("Quota exhausted"));
    this.data.set(app.id, app);
    return Promise.resolve();
  }
  remove(id: ApplicationId): Promise<void> {
    this.data.delete(id);
    return Promise.resolve();
  }
}
class Archives implements ArchiveRepository {
  readonly data = new Map<string, Blob>();
  rejectRemoval = false;
  onWrite: (() => void) | undefined;
  write(
    file: File,
    progress: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<ArchiveReference> {
    signal.throwIfAborted();
    const key = crypto.randomUUID();
    this.data.set(key, file);
    progress(file.size);
    this.onWrite?.();
    return Promise.resolve({ kind: ArchiveKind.Database, key });
  }
  read(reference: ArchiveReference): Promise<Blob> {
    const result = this.data.get(reference.key);
    return result ? Promise.resolve(result) : Promise.reject(new Error("Missing archive"));
  }
  remove(reference: ArchiveReference): Promise<void> {
    if (this.rejectRemoval) return Promise.reject(new Error("Archive storage unavailable"));
    this.data.delete(reference.key);
    return Promise.resolve();
  }
}
const metadata: ApplicationMetadata = {
  platform: Platform.IOS,
  bundleId: "test.example",
  name: "Example",
  version: "1.0",
  icon: null,
};
const file = new File(["original app"], "example.ipa");
const replacement = new File(["replacement app"], "example-update.ipa");
function setup() {
  const records = new Records();
  const archives = new Archives();
  const cleanupErrors: unknown[] = [];
  let selected = metadata;
  const environment: LibraryEnvironment = {
    now: () => Date.now(),
    exclusive: (_id, operation) => operation(),
    ensureCapacity: () => Promise.resolve(),
    requestPersistence: () => Promise.resolve(true),
    cleanupFailure: (error) => cleanupErrors.push(error),
  };
  const inspector = { inspect: () => Promise.resolve(selected) };
  const library = new ApplicationLibrary(records, archives, inspector, environment);
  const importFile = (input = file, signal = new AbortController().signal) =>
    library.import(input, signal, () => undefined);
  return {
    records,
    archives,
    cleanupErrors,
    library,
    importFile,
    select: (value: ApplicationMetadata) => {
      selected = value;
    },
  };
}

describe("app ownership and replacement", () => {
  test("a rejected metadata commit leaves the old app usable and removes the new archive", async () => {
    const context = setup();
    const original = await context.importFile();
    context.records.rejectWrites = true;
    await expect(context.importFile(replacement)).rejects.toThrow("Quota exhausted");
    expect(await context.library.get(original.id)).toEqual(original);
    expect(await (await context.library.open(original)).text()).toBe("original app");
    expect(context.archives.data.size).toBe(1);
  });

  test("cancellation after archive storage rolls back the pending import", async () => {
    const context = setup();
    const original = await context.importFile();
    const cancellation = new AbortController();
    context.archives.onWrite = () => cancellation.abort();
    await expect(context.importFile(replacement, cancellation.signal)).rejects.toThrow();
    expect(await context.library.get(original.id)).toEqual(original);
    expect(context.archives.data.size).toBe(1);
  });

  test("replacement preserves identity and last played time while changing only the archive", async () => {
    const context = setup();
    const original = await context.importFile();
    await context.library.played(original.id);
    const before = await context.library.get(original.id);
    const updated = await context.importFile(replacement);
    expect(updated.id).toBe(original.id);
    expect(updated.lastPlayedAt).toBe(before?.lastPlayedAt);
    expect(await (await context.library.open(updated)).text()).toBe("replacement app");
    expect(context.archives.data.has(original.archive.key)).toBe(false);
  });

  test("failed old-archive cleanup cannot invalidate a committed replacement", async () => {
    const context = setup();
    await context.importFile();
    context.archives.rejectRemoval = true;
    const updated = await context.importFile(replacement);
    expect(await context.library.get(updated.id)).toEqual(updated);
    expect(await (await context.library.open(updated)).text()).toBe("replacement app");
    expect(context.cleanupErrors).toHaveLength(1);
  });

  test("matching Android and iOS bundle names have separate identities", async () => {
    const context = setup();
    const ios = await context.importFile();
    context.select({ ...metadata, platform: Platform.Android });
    const android = await context.importFile();
    expect(ios.id).not.toBe(android.id);
    expect(await context.library.list()).toHaveLength(2);
  });

  test("removal touches only the selected app and archive", async () => {
    const context = setup();
    const first = await context.importFile();
    context.select({ ...metadata, bundleId: "test.second" });
    const second = await context.importFile();
    await context.library.remove(first.id);
    expect(await context.library.list()).toEqual([second]);
    expect(await (await context.library.open(second)).text()).toBe("original app");
  });

  test("an invalid identifier cannot enter storage", () => {
    expect(() => applicationId(Platform.IOS, "")).toThrow();
    expect(() => applicationId(Platform.Android, "invalid\0identifier")).toThrow();
  });
});
