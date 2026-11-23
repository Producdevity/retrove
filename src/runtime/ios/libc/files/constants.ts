export const Open = {
  ReadOnly: 0,
  WriteOnly: 1,
  ReadWrite: 2,
  Invalid: 3,
  AccessMask: 3,
  Append: 8,
  Sync: 0x80,
  NoFollow: 0x100,
  Create: 0x200,
  Truncate: 0x400,
  Exclusive: 0x800,
  NoControllingTerminal: 0x20000,
  CloseOnExec: 0x1000000,
} as const;
export const SUPPORTED_OPEN_FLAGS =
  Open.AccessMask |
  Open.Append |
  Open.Create |
  Open.Truncate |
  Open.Exclusive |
  Open.Sync |
  Open.NoFollow |
  Open.NoControllingTerminal |
  Open.CloseOnExec;
export const Whence = { Set: 0, Current: 1, End: 2 } as const;
export const Fcntl = {
  GetDescriptorFlags: 1,
  SetDescriptorFlags: 2,
  GetStatusFlags: 3,
  SetStatusFlags: 4,
  NoCache: 48,
  GetPath: 50,
  FullSync: 51,
} as const;
export const DescriptorFlag = { CloseOnExec: 1, NonBlocking: 4, Append: 8 } as const;
export const Mode = {
  TypeMask: 0o170000,
  Directory: 0o40000,
  Character: 0o20000,
  Regular: 0o100000,
  Socket: 0o140000,
  Permissions: 0o7777,
  FileDefault: 0o644,
  DirectoryDefault: 0o755,
  BundleFile: 0o444,
  BundleExecutable: 0o555,
  BundleDirectory: 0o555,
  Temporary: 0o600,
  StandardDevice: 0o666,
  OwnerRead: 0o400,
  OwnerWrite: 0o200,
  OwnerShift: 6,
  AccessBits: 7,
  WriteAccess: 2,
} as const;
export const Device = { Bundle: 1, Save: 2, Standard: 3 } as const;
export const FIRST_FILE_DESCRIPTOR = 3;
export const Standard = { Input: 0, Output: 1, Error: 2 } as const;
export const STANDARD_STREAM_SYMBOLS = ["___stdinp", "___stdoutp", "___stderrp"] as const;
export const DIRECTORY_LINKS = 2;
export const SAVE_ROOTS: ReadonlySet<string> = new Set(["Documents", "Library", "tmp"]);
/** Separate chunks keep small writes and sparse seeks independent of total save size. */
export const CHUNK_BYTES = 65536;
/** Bundle files from this size are read through a stored blob instead of being inflated on every open. */
export const RANDOM_ACCESS_BYTES = 262144;
export const LOOKUP_SAMPLE_LIMIT = 24;
export const LOOKUP_PATH_LIMIT = 512;
export const CONSOLE_WRITE_LIMIT = 65536;
export const PATH_LIMIT = 1024;
export const MAX_TRANSFER_BYTES = 0x7fffffff;
export const WORD_BYTES = 4;
export const Stream = {
  Bytes: 96,
  Status: 12,
  Scratch: 64,
  ReadFlag: 4,
  WriteFlag: 8,
  ReadWriteFlag: 16,
  EofFlag: 0x20,
  ErrorFlag: 0x40,
} as const;
export const LINE_READ_BYTES = 1024;
export const TEMPORARY_NAME_BYTES = 32;
export const TEMPORARY_NAME_RADIX = 36;
export const BYTE_MASK = 255;
export const NEWLINE = 10;
export const INT64_BITS = 64;
export const WORD_BITS = 32n;
export const ZERO = 0n;
export const DIRENT_HANDLE_HEADER = 4;
export const LAST_BUFFER_MODE = 2;
export const FAILED_OFFSET = -1n;
