export const Errno = {
  Perm: 1,
  NoEntry: 2,
  Io: 5,
  BadDescriptor: 9,
  NoMemory: 12,
  Access: 13,
  Fault: 14,
  Exists: 17,
  NotDirectory: 20,
  IsDirectory: 21,
  Invalid: 22,
  TooBig: 27,
  NoSpace: 28,
  IllegalSeek: 29,
  ReadOnly: 30,
  Range: 34,
  NotSupported: 45,
  NameTooLong: 63,
  NotEmpty: 66,
  Overflow: 84,
  AttributeNotFound: 93,
} as const;

export class FileError extends Error {
  constructor(readonly errno: number) {
    super(`File error ${errno}`);
  }
}

export function raise(errno: number): never {
  throw new FileError(errno);
}
