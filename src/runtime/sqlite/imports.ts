import type { GuestArguments } from "../ios/objc/host";
import { OpenFlag, SqliteCode } from "./engine";
import { SqliteObjects, type Connection, type SqliteHost } from "./connections";
import { statementImports, type SqliteImports } from "./statements";

export type { SqliteHost } from "./connections";
const INT64_BITS = 64;
const Arg = { First: 0, Second: 1, Third: 2, Fourth: 3, Fifth: 4 } as const;
const VERSION = "3.54.1";
const VERSION_NUMBER = 3_054_001;
const THREADSAFE = 1;
const WORD = 4;
const ENCODER = new TextEncoder();

/** libsqlite3.dylib for guest apps, backed by SQLite compiled to WebAssembly. */
export function sqliteImports(host: SqliteHost): SqliteImports {
  let objects: SqliteObjects | undefined;
  const ready = (): SqliteObjects => {
    if (!objects) throw new Error("SQLite was used before a database was opened.");
    return objects;
  };
  const open = async (path: number, output: number, flags: number) => {
    objects ??= new SqliteObjects(host, await host.engine());
    const { code, handle } = await objects.open(path, flags);
    if (output) host.write(output, handle);
    return code;
  };
  const withConnection =
    (use: (connection: Connection, objects: SqliteObjects) => number | bigint) =>
    (a: GuestArguments) => {
      const connection = objects?.connection(a(Arg.First));
      return connection && objects ? use(connection, objects) : SqliteCode.Misuse;
    };
  let version = 0;
  return {
    _sqlite3_open: (a) => open(a(Arg.First), a(Arg.Second), OpenFlag.ReadWrite | OpenFlag.Create),
    _sqlite3_open_v2: (a) => open(a(Arg.First), a(Arg.Second), a(Arg.Third)),
    _sqlite3_close: (a) => close(a, false),
    _sqlite3_close_v2: (a) => close(a, true),
    _sqlite3_errmsg: withConnection((connection, objects) => {
      if (connection.message) host.free(connection.message);
      const pointer = connection.db ? objects.engine.number("sqlite3_errmsg", connection.db) : 0;
      connection.message = objects.guestString(
        pointer ? objects.engine.cString(pointer) : ENCODER.encode("out of memory"),
      );
      return connection.message;
    }),
    ...connectionNumbers(withConnection),
    _sqlite3_exec: (a) => exec(ready, a),
    _sqlite3_malloc: (a) => host.allocate(Math.max(1, a(Arg.First) | 0)),
    _sqlite3_free: (a) => {
      if (a(Arg.First)) host.free(a(Arg.First));
      return 0;
    },
    _sqlite3_libversion: () => (version ||= stringOnce(host)),
    _sqlite3_libversion_number: () => VERSION_NUMBER,
    _sqlite3_threadsafe: () => THREADSAFE,
    ...statementImports(ready),
  };

  async function close(a: GuestArguments, deferred: boolean) {
    const connection = objects?.connection(a(Arg.First));
    if (!a(Arg.First)) return SqliteCode.Ok;
    return connection && objects ? objects.close(connection, deferred) : SqliteCode.Misuse;
  }
}

function stringOnce(host: SqliteHost): number {
  const bytes = ENCODER.encode(VERSION);
  const pointer = host.allocate(bytes.length + 1);
  host.writeBytes(pointer, bytes);
  host.writeBytes(pointer + bytes.length, new Uint8Array(1));
  return pointer;
}

function connectionNumbers(
  withConnection: (
    use: (connection: Connection, objects: SqliteObjects) => number | bigint,
  ) => (a: GuestArguments) => number | bigint,
): SqliteImports {
  const count = (name: string) =>
    withConnection((connection, objects) => objects.engine.number(name, connection.db));
  return {
    _sqlite3_errcode: count("sqlite3_errcode"),
    _sqlite3_extended_errcode: count("sqlite3_extended_errcode"),
    _sqlite3_changes: count("sqlite3_changes"),
    _sqlite3_total_changes: count("sqlite3_total_changes"),
    _sqlite3_get_autocommit: count("sqlite3_get_autocommit"),
    _sqlite3_last_insert_rowid: withConnection((connection, objects) =>
      BigInt.asUintN(INT64_BITS, objects.engine.bigint("sqlite3_last_insert_rowid", connection.db)),
    ),
  };
}

/** sqlite3_exec: runs each statement, passing rows to the guest callback as C strings. */
async function exec(ready: () => SqliteObjects, a: GuestArguments): Promise<number> {
  const objects = ready(),
    { engine, host } = objects;
  const connection = objects.connection(a(Arg.First));
  const errorOutput = a(Arg.Fifth);
  if (errorOutput) host.write(errorOutput, 0);
  if (!connection) return SqliteCode.Misuse;
  const fail = (code: number) => {
    objects.reportFailure("exec", connection, code);
    if (errorOutput && code !== SqliteCode.Ok)
      host.write(
        errorOutput,
        objects.guestString(engine.cString(engine.number("sqlite3_errmsg", connection.db))),
      );
    return code;
  };
  const source = engine.copyString(host.cString(a(Arg.Second)));
  try {
    for (let sql = source; engine.read(sql, 1)[0];) {
      const prepared = engine.withPointer((slot) =>
        engine.withPointer((tail) => {
          const code = engine.number("sqlite3_prepare_v2", connection.db, sql, -1, slot, tail);
          return { code, stmt: engine.word(slot), next: engine.word(tail) };
        }),
      );
      if (prepared.code !== SqliteCode.Ok) return fail(prepared.code);
      sql = prepared.next;
      if (!prepared.stmt) continue;
      const code = await run(objects, prepared.stmt, a(Arg.Third), a(Arg.Fourth));
      engine.number("sqlite3_finalize", prepared.stmt);
      if (code === SqliteCode.Abort) return SqliteCode.Abort;
      if (code !== SqliteCode.Done) return fail(code);
    }
    await objects.persist(connection);
    return SqliteCode.Ok;
  } finally {
    engine.free(source);
  }
}
async function run(objects: SqliteObjects, stmt: number, callback: number, argument: number) {
  const { engine, host } = objects;
  for (;;) {
    const code = engine.number("sqlite3_step", stmt);
    if (code !== SqliteCode.Row || !callback) {
      if (code === SqliteCode.Row) continue;
      return code;
    }
    const columns = engine.number("sqlite3_column_count", stmt);
    const strings: number[] = [];
    const array = (values: number[]) => {
      const pointer = host.allocate(Math.max(1, values.length) * WORD);
      values.forEach((value, index) => host.write(pointer + index * WORD, value));
      return pointer;
    };
    const text = (name: string, index: number) => {
      const pointer = engine.number(name, stmt, index);
      if (!pointer) return 0;
      const copy = objects.guestString(engine.cString(pointer));
      strings.push(copy);
      return copy;
    };
    const indexes = Array.from({ length: columns }, (_, index) => index);
    const values = array(indexes.map((index) => text("sqlite3_column_text", index)));
    const names = array(indexes.map((index) => text("sqlite3_column_name", index)));
    try {
      if (await host.callGuest(callback, [argument, columns, values, names]))
        return SqliteCode.Abort;
    } finally {
      for (const pointer of [...strings, values, names]) host.free(pointer);
    }
  }
}
