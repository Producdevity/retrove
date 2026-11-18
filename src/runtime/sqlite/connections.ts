import { OpenFlag, SqliteCode, type SqliteEngine } from "./engine";

const MEMORY = ":memory:";
const TEXT = new TextDecoder();
const SQL_PREVIEW = 160;

/** Guest memory, files and calls the libsqlite3 bridge needs. */
export interface SqliteHost {
  read(pointer: number): number;
  write(pointer: number, value: number): void;
  readBytes(pointer: number, length: number): Uint8Array;
  writeBytes(pointer: number, bytes: Uint8Array): void;
  /** Bytes of a guest NUL-terminated string, without the terminator. */
  cString(pointer: number): Uint8Array;
  allocate(bytes: number): number;
  free(pointer: number): void;
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  callGuest(implementation: number, args: readonly number[]): Promise<number>;
  engine(): Promise<SqliteEngine>;
  warn(message: string, details: Record<string, unknown>): void;
}
export interface Connection {
  readonly handle: number;
  readonly db: number;
  /** The guest file the database persists to; undefined for in-memory databases. */
  readonly path: string | undefined;
  savedChanges: number;
  message: number;
}
export interface Statement {
  readonly handle: number;
  readonly stmt: number;
  readonly connection: Connection;
  /** Guest copies of the current row's text and blobs, valid until the next step. */
  readonly row: number[];
  readonly names: Map<string, number>;
}

/** Guest handles for SQLite connections and statements, and database persistence. */
export class SqliteObjects {
  readonly connections = new Map<number, Connection>();
  readonly statements = new Map<number, Statement>();
  constructor(
    readonly host: SqliteHost,
    readonly engine: SqliteEngine,
  ) {}
  /** A guest copy of `bytes` with a terminator, owned by the caller. */
  guestString(bytes: Uint8Array): number {
    const pointer = this.host.allocate(bytes.length + 1);
    this.host.writeBytes(pointer, bytes);
    this.host.writeBytes(pointer + bytes.length, new Uint8Array(1));
    return pointer;
  }
  /** Logs a failed call with SQLite's message and, when given, the statement text. */
  reportFailure(call: string, connection: Connection, code: number, sql = 0): void {
    const message = TEXT.decode(
      this.engine.cString(this.engine.number("sqlite3_errmsg", connection.db)),
    );
    const statement = sql ? TEXT.decode(this.engine.cString(sql)).slice(0, SQL_PREVIEW) : "";
    this.host.warn(`SQLite ${call} failed`, { code, message, statement, path: connection.path });
  }
  connection(handle: number): Connection | undefined {
    return this.connections.get(handle);
  }
  statement(handle: number): Statement | undefined {
    return this.statements.get(handle);
  }
  async open(pathPointer: number, flags: number): Promise<{ code: number; handle: number }> {
    const name = pathPointer ? this.host.cString(pathPointer) : new Uint8Array();
    const path = TEXT.decode(name);
    const persistent = path !== "" && path !== MEMORY && !path.startsWith("file::memory:");
    const stored = persistent ? await this.host.readFile(path) : undefined;
    const canCreate = (flags & OpenFlag.Create) !== 0;
    const readOnly = (flags & OpenFlag.ReadWrite) === 0;
    // A missing file without SQLITE_OPEN_CREATE fails in SQLite itself, with its own message.
    const opened = this.engine.open(
      persistent && !stored && !canCreate ? name : new TextEncoder().encode(MEMORY),
      persistent && !stored && !canCreate ? flags : OpenFlag.ReadWrite | OpenFlag.Create,
    );
    let code = opened.code;
    if (code === SqliteCode.Ok && stored) code = this.engine.load(opened.db, stored, readOnly);
    const handle = this.host.allocate(1);
    this.connections.set(handle, {
      handle,
      db: opened.db,
      path: persistent && code === SqliteCode.Ok && !readOnly ? path : undefined,
      savedChanges: opened.db ? this.engine.number("sqlite3_total_changes", opened.db) : 0,
      message: 0,
    });
    return { code, handle };
  }
  /** Writes the database back to its guest file after committed changes. */
  async persist(connection: Connection): Promise<void> {
    if (!connection.path || !this.engine.number("sqlite3_get_autocommit", connection.db)) return;
    const changes = this.engine.number("sqlite3_total_changes", connection.db);
    if (changes === connection.savedChanges) return;
    connection.savedChanges = changes;
    await this.host.writeFile(connection.path, this.engine.save(connection.db));
  }
  releaseRow(statement: Statement): void {
    for (const pointer of statement.row.splice(0)) this.host.free(pointer);
  }
  dropStatement(statement: Statement): void {
    this.releaseRow(statement);
    for (const pointer of statement.names.values()) this.host.free(pointer);
    this.statements.delete(statement.handle);
    this.host.free(statement.handle);
  }
  /** `deferred` is sqlite3_close_v2: unfinalized statements stay usable until finalized. */
  async close(connection: Connection, deferred: boolean) {
    const pending = [...this.statements.values()].some((s) => s.connection === connection);
    if (!deferred && pending) return SqliteCode.Busy;
    if (connection.db) await this.persist(connection);
    const code = connection.db
      ? this.engine.number("sqlite3_close_v2", connection.db)
      : SqliteCode.Ok;
    if (code !== SqliteCode.Ok) return code;
    if (connection.message) this.host.free(connection.message);
    this.connections.delete(connection.handle);
    this.host.free(connection.handle);
    return code;
  }
}
