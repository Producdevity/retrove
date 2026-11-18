import type { GuestArguments } from "../ios/objc/host";
import { SqliteCode, TRANSIENT } from "./engine";
import type { SqliteObjects, Statement } from "./connections";

type Result = number | bigint | Promise<number | bigint>;
export type SqliteImports = Record<string, (args: GuestArguments) => Result>;
const INT64_BITS = 64;
const Arg = { First: 0, Second: 1, Third: 2, Fourth: 3, Fifth: 4, Sixth: 5 } as const;
/** SQLITE_STATIC and SQLITE_TRANSIENT; any other destructor is a guest function. */
const STATIC_DESTRUCTOR = 0;
const TRANSIENT_DESTRUCTOR = 0xffffffff;
const WORD_BITS = 32n;
const DOUBLE_BYTES = 8;
const HALVES = 2;
const PREPARE_V3 = "sqlite3_prepare_v3";

function int64(low: number, high: number): bigint {
  return BigInt.asIntN(INT64_BITS, (BigInt(high >>> 0) << WORD_BITS) | BigInt(low >>> 0));
}
function doubleFrom(low: number, high: number): number {
  const view = new DataView(new ArrayBuffer(DOUBLE_BYTES));
  view.setUint32(0, low >>> 0, true);
  view.setUint32(DOUBLE_BYTES / HALVES, high >>> 0, true);
  return view.getFloat64(0, true);
}
function doubleBits(value: number): bigint {
  const view = new DataView(new ArrayBuffer(DOUBLE_BYTES));
  view.setFloat64(0, value, true);
  return view.getBigUint64(0, true);
}

/** Statement preparation, stepping and finalization. */
export function statementImports(ready: () => SqliteObjects): SqliteImports {
  const prepare = (a: GuestArguments, v3 = false): Result => {
    const objects = ready(),
      { engine, host } = objects;
    const connection = objects.connection(a(Arg.First));
    const [output, tailOutput] = v3 ? [a(Arg.Fifth), a(Arg.Sixth)] : [a(Arg.Fourth), a(Arg.Fifth)];
    if (output) host.write(output, 0);
    if (!connection) return SqliteCode.Misuse;
    const sql = a(Arg.Second),
      limit = a(Arg.Third) | 0;
    const text = limit < 0 ? host.cString(sql) : host.readBytes(sql, limit);
    const end = text.indexOf(0);
    const source = engine.copyString(end < 0 ? text : text.subarray(0, end));
    try {
      return engine.withPointer((slot) =>
        engine.withPointer((tail) => {
          const code = v3
            ? engine.number(PREPARE_V3, connection.db, source, -1, a(Arg.Fourth), slot, tail)
            : engine.number("sqlite3_prepare_v2", connection.db, source, -1, slot, tail);
          if (tailOutput) host.write(tailOutput, sql + (engine.word(tail) - source));
          const stmt = engine.word(slot);
          if (code !== SqliteCode.Ok) objects.reportFailure("prepare", connection, code, source);
          if (code !== SqliteCode.Ok || !stmt) return code;
          const handle = host.allocate(1);
          objects.statements.set(handle, { handle, stmt, connection, row: [], names: new Map() });
          if (output) host.write(output, handle);
          return code;
        }),
      );
    } finally {
      engine.free(source);
    }
  };
  const withStatement: WithStatement =
    (use, missing = SqliteCode.Misuse) =>
    (a: GuestArguments): Result => {
      const objects = ready(),
        statement = objects.statement(a(Arg.First));
      return statement ? use(statement, objects) : missing;
    };
  return {
    _sqlite3_prepare: (a) => prepare(a),
    _sqlite3_prepare_v2: (a) => prepare(a),
    _sqlite3_prepare_v3: (a) => prepare(a, true),
    _sqlite3_step: withStatement(async (statement, objects) => {
      objects.releaseRow(statement);
      const code = objects.engine.number("sqlite3_step", statement.stmt);
      if (code === SqliteCode.Done) await objects.persist(statement.connection);
      else if (code !== SqliteCode.Row) objects.reportFailure("step", statement.connection, code);
      return code;
    }),
    _sqlite3_reset: withStatement((statement, objects) => {
      objects.releaseRow(statement);
      return objects.engine.number("sqlite3_reset", statement.stmt);
    }, SqliteCode.Ok),
    _sqlite3_finalize: (a) => {
      const objects = ready(),
        statement = objects.statement(a(Arg.First));
      if (!statement) return SqliteCode.Ok;
      const code = objects.engine.number("sqlite3_finalize", statement.stmt);
      objects.dropStatement(statement);
      return objects.persist(statement.connection).then(() => code);
    },
    ...bindImports(withStatement),
    ...columnImports(withStatement),
  };
}

/** `missing` is the result for a NULL or unknown statement; SQLite returns 0 from column getters. */
type WithStatement = (
  use: (statement: Statement, objects: SqliteObjects) => Result,
  missing?: number,
) => (a: GuestArguments) => Result;

function bindImports(withStatement: WithStatement): SqliteImports {
  const bindBytes = (name: "sqlite3_bind_text" | "sqlite3_bind_blob") => (a: GuestArguments) =>
    withStatement(async (statement, objects) => {
      const { engine, host } = objects,
        index = a(Arg.Second),
        pointer = a(Arg.Third),
        length = a(Arg.Fourth) | 0;
      if (!pointer) return engine.number("sqlite3_bind_null", statement.stmt, index);
      const bytes =
        length < 0 && name === "sqlite3_bind_text"
          ? host.cString(pointer)
          : host.readBytes(pointer, Math.max(0, length));
      const copy = engine.allocate(bytes.length);
      engine.write(copy, bytes);
      const code = engine.number(name, statement.stmt, index, copy, bytes.length, TRANSIENT);
      engine.free(copy);
      const destructor = a(Arg.Fifth) >>> 0;
      if (destructor !== STATIC_DESTRUCTOR && destructor !== TRANSIENT_DESTRUCTOR)
        await host.callGuest(destructor, [pointer]);
      return code;
    })(a);
  const simple =
    (use: (statement: Statement, objects: SqliteObjects, a: GuestArguments) => number) =>
    (a: GuestArguments) =>
      withStatement((statement, objects) => use(statement, objects, a))(a);
  return {
    _sqlite3_bind_text: bindBytes("sqlite3_bind_text"),
    _sqlite3_bind_blob: bindBytes("sqlite3_bind_blob"),
    _sqlite3_bind_int: simple((s, o, a) =>
      o.engine.number("sqlite3_bind_int", s.stmt, a(Arg.Second), a(Arg.Third) | 0),
    ),
    _sqlite3_bind_int64: simple((s, o, a) =>
      o.engine.number(
        "sqlite3_bind_int64",
        s.stmt,
        a(Arg.Second),
        int64(a(Arg.Third), a(Arg.Fourth)),
      ),
    ),
    _sqlite3_bind_double: simple((s, o, a) =>
      o.engine.number(
        "sqlite3_bind_double",
        s.stmt,
        a(Arg.Second),
        doubleFrom(a(Arg.Third), a(Arg.Fourth)),
      ),
    ),
    _sqlite3_bind_null: simple((s, o, a) =>
      o.engine.number("sqlite3_bind_null", s.stmt, a(Arg.Second)),
    ),
    _sqlite3_bind_parameter_count: simple((s, o) =>
      o.engine.number("sqlite3_bind_parameter_count", s.stmt),
    ),
    _sqlite3_bind_parameter_index: simple((s, o, a) => {
      const name = o.engine.copyString(o.host.cString(a(Arg.Second)));
      try {
        return o.engine.number("sqlite3_bind_parameter_index", s.stmt, name);
      } finally {
        o.engine.free(name);
      }
    }),
    _sqlite3_clear_bindings: simple((s, o) => o.engine.number("sqlite3_clear_bindings", s.stmt)),
  };
}

function columnImports(withStatement: WithStatement): SqliteImports {
  const column =
    (use: (statement: Statement, objects: SqliteObjects, index: number) => Result) =>
    (a: GuestArguments) =>
      withStatement((statement, objects) => use(statement, objects, a(Arg.Second)), 0)(a);
  const copyValue = (name: "sqlite3_column_text" | "sqlite3_column_blob") =>
    column((statement, { engine, host }, index) => {
      const pointer = engine.number(name, statement.stmt, index);
      const length = engine.number("sqlite3_column_bytes", statement.stmt, index);
      if (!pointer || (name === "sqlite3_column_blob" && !length)) return 0;
      const copy = host.allocate(length + 1);
      host.writeBytes(copy, engine.read(pointer, length));
      host.writeBytes(copy + length, new Uint8Array(1));
      statement.row.push(copy);
      return copy;
    });
  const named = (name: "sqlite3_column_name" | "sqlite3_column_decltype") =>
    column((statement, objects, index) => {
      const key = `${name}:${index}`;
      const cached = statement.names.get(key);
      if (cached !== undefined) return cached;
      const pointer = objects.engine.number(name, statement.stmt, index);
      const copy = pointer ? objects.guestString(objects.engine.cString(pointer)) : 0;
      statement.names.set(key, copy);
      return copy;
    });
  const integer = (name: string) =>
    column((statement, objects, index) => objects.engine.number(name, statement.stmt, index));
  return {
    _sqlite3_column_text: copyValue("sqlite3_column_text"),
    _sqlite3_column_blob: copyValue("sqlite3_column_blob"),
    _sqlite3_column_name: named("sqlite3_column_name"),
    _sqlite3_column_decltype: named("sqlite3_column_decltype"),
    _sqlite3_column_bytes: integer("sqlite3_column_bytes"),
    _sqlite3_column_type: integer("sqlite3_column_type"),
    _sqlite3_column_int: integer("sqlite3_column_int"),
    _sqlite3_column_int64: column((statement, objects, index) =>
      BigInt.asUintN(
        INT64_BITS,
        objects.engine.bigint("sqlite3_column_int64", statement.stmt, index),
      ),
    ),
    _sqlite3_column_double: column((statement, objects, index) =>
      doubleBits(objects.engine.number("sqlite3_column_double", statement.stmt, index)),
    ),
    _sqlite3_column_count: withStatement(
      (s, o) => o.engine.number("sqlite3_column_count", s.stmt),
      0,
    ),
    _sqlite3_data_count: withStatement((s, o) => o.engine.number("sqlite3_data_count", s.stmt), 0),
  };
}
