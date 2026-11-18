import { describe, expect, it } from "vite-plus/test";
import initialize from "../../../web/vendor/sqlite3-node.mjs";
import { SqliteEngine } from "./engine";
import { sqliteImports } from "./imports";

const engine = initialize({ print: () => undefined, printErr: () => undefined }).then(
  (module) => new SqliteEngine(module),
);
const Code = { Ok: 0, Row: 100, Done: 101 } as const;

function guest(files: Map<string, Uint8Array>) {
  const memory = new Uint8Array(1 << 20);
  const view = new DataView(memory.buffer);
  let next = 0x100;
  const allocate = (bytes: number) => {
    const pointer = next;
    next += (bytes + 15) & ~15;
    return pointer;
  };
  const callbacks: number[][] = [];
  const warnings: { message: string; details: Record<string, unknown> }[] = [];
  const imports = sqliteImports({
    read: (pointer) => view.getUint32(pointer, true),
    write: (pointer, value) => view.setUint32(pointer, value >>> 0, true),
    readBytes: (pointer, length) => memory.slice(pointer, pointer + length),
    writeBytes: (pointer, bytes) => memory.set(bytes, pointer),
    cString: (pointer) => memory.slice(pointer, memory.indexOf(0, pointer)),
    allocate,
    free: () => undefined,
    readFile: async (path) => files.get(path),
    writeFile: async (path, bytes) => void files.set(path, bytes),
    callGuest: async (_function, args) => {
      callbacks.push([...args]);
      return 0;
    },
    engine: () => engine,
    warn: (message, details) => warnings.push({ message, details }),
  });
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    const pointer = allocate(bytes.length + 1);
    memory.set(bytes, pointer);
    return pointer;
  };
  const string = (pointer: number) =>
    new TextDecoder().decode(memory.slice(pointer, memory.indexOf(0, pointer)));
  const call = async (name: string, ...values: number[]) =>
    await imports[name]?.((index) => values[index] ?? 0);
  return { call, text, string, view, allocate, callbacks, warnings };
}

describe("libsqlite3", () => {
  it("stores rows in the guest file and reads them back after reopening", async () => {
    const files = new Map<string, Uint8Array>();
    const first = guest(files);
    const slot = first.allocate(4);
    expect(await first.call("_sqlite3_open", first.text("/Documents/scores.db"), slot)).toBe(
      Code.Ok,
    );
    const db = first.view.getUint32(slot, true);
    expect(
      await first.call(
        "_sqlite3_exec",
        db,
        first.text("CREATE TABLE s(name TEXT, score INTEGER)"),
        0,
        0,
        0,
      ),
    ).toBe(Code.Ok);
    const statement = first.allocate(4);
    expect(
      await first.call(
        "_sqlite3_prepare_v2",
        db,
        first.text("INSERT INTO s VALUES(?, ?)"),
        -1,
        statement,
        0,
      ),
    ).toBe(Code.Ok);
    const insert = first.view.getUint32(statement, true);
    await first.call("_sqlite3_bind_text", insert, 1, first.text("ada"), -1, 0xffffffff);
    await first.call("_sqlite3_bind_int64", insert, 2, 0x1_0000, 1);
    expect(await first.call("_sqlite3_step", insert)).toBe(Code.Done);
    await first.call("_sqlite3_finalize", insert);
    expect(files.get("/Documents/scores.db")?.length).toBeGreaterThan(0);
    await first.call("_sqlite3_close", db);

    const second = guest(files);
    const reopened = second.allocate(4);
    await second.call("_sqlite3_open", second.text("/Documents/scores.db"), reopened);
    const handle = second.view.getUint32(reopened, true);
    const query = second.allocate(4);
    await second.call(
      "_sqlite3_prepare_v2",
      handle,
      second.text("SELECT name, score FROM s"),
      -1,
      query,
      0,
    );
    const select = second.view.getUint32(query, true);
    expect(await second.call("_sqlite3_step", select)).toBe(Code.Row);
    expect(second.string(Number(await second.call("_sqlite3_column_text", select, 0)))).toBe("ada");
    expect(await second.call("_sqlite3_column_int64", select, 1)).toBe(0x1_0001_0000n);
    expect(second.string(Number(await second.call("_sqlite3_column_name", select, 1)))).toBe(
      "score",
    );
    expect(await second.call("_sqlite3_step", select)).toBe(Code.Done);
  });
  it("reports errors and runs exec callbacks per row", async () => {
    const memory = guest(new Map());
    const slot = memory.allocate(4);
    await memory.call("_sqlite3_open", memory.text(":memory:"), slot);
    const db = memory.view.getUint32(slot, true);
    const error = memory.allocate(4);
    expect(
      await memory.call("_sqlite3_exec", db, memory.text("SELECT * FROM missing"), 0, 0, error),
    ).toBe(1);
    expect(memory.string(memory.view.getUint32(error, true))).toContain("no such table");
    await memory.call("_sqlite3_exec", db, memory.text("SELECT 1 AS one; SELECT 2"), 0x4000, 7, 0);
    expect(memory.callbacks.map((args) => args.slice(0, 2))).toEqual([
      [7, 1],
      [7, 1],
    ]);
  });
  it("logs a failed prepare and treats the NULL statement like SQLite does", async () => {
    const memory = guest(new Map());
    const slot = memory.allocate(4);
    await memory.call("_sqlite3_open", memory.text(":memory:"), slot);
    const db = memory.view.getUint32(slot, true);
    const output = memory.allocate(4);
    const sql = memory.text("SELECT * FROM missing");
    expect(await memory.call("_sqlite3_prepare_v2", db, sql, -1, output, 0)).toBe(1);
    const statement = memory.view.getUint32(output, true);
    expect(statement).toBe(0);
    expect(await memory.call("_sqlite3_column_count", statement)).toBe(0);
    expect(await memory.call("_sqlite3_column_name", statement, 0)).toBe(0);
    expect(await memory.call("_sqlite3_reset", statement)).toBe(Code.Ok);
    expect(await memory.call("_sqlite3_finalize", statement)).toBe(Code.Ok);
    expect(memory.warnings[0]?.details).toMatchObject({
      message: "no such table: missing",
      statement: "SELECT * FROM missing",
    });
  });
});
