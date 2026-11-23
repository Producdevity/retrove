import { statBytes } from "../file-metadata";
import { Argument, type GuestArguments } from "../../objc/host";
import type { GuestImport } from "../guest-imports";
import {
  DescriptorFlag,
  Fcntl,
  FAILED_OFFSET,
  INT64_BITS,
  PATH_LIMIT,
  WORD_BITS,
} from "./constants";
import { Errno, raise } from "./errno";
import type { FileSystem } from "./file-system";
import { openFile } from "./open";
import { descriptorStat, pathStat } from "./stat";
import { closeDescriptor, readDescriptor, seekDescriptor, writeDescriptor } from "./transfer";

function descriptorPath(
  fs: FileSystem,
  file: { path?: string | undefined; device?: unknown },
  arg: number,
): number {
  if (!arg) raise(Errno.Fault);
  if (!file.path || file.device) raise(Errno.Invalid);
  const name = new TextEncoder().encode(`/${file.path}\0`);
  if (name.length > PATH_LIMIT) raise(Errno.NameTooLong);
  fs.cpu.write(arg, name);
  return 0;
}

function fcntl(fs: FileSystem, a: GuestArguments): number {
  const cmd = a(1),
    arg = a(Argument.Third),
    file = fs.fdFor(a(0));
  switch (cmd) {
    case Fcntl.GetDescriptorFlags:
      return file.closeOnExec ? 1 : 0;
    case Fcntl.SetDescriptorFlags:
      file.closeOnExec = Boolean(arg & DescriptorFlag.CloseOnExec);
      return 0;
    case Fcntl.GetStatusFlags:
      return (
        file.mode |
        (file.append ? DescriptorFlag.Append : 0) |
        (file.nonblocking ? DescriptorFlag.NonBlocking : 0)
      );
    case Fcntl.SetStatusFlags:
      file.nonblocking = Boolean(arg & DescriptorFlag.NonBlocking);
      file.append = Boolean(arg & DescriptorFlag.Append);
      return 0;
    case Fcntl.NoCache: // F_NOCACHE is an advisory hint.
      return 0;
    case Fcntl.GetPath:
      return descriptorPath(fs, file, arg);
    case Fcntl.FullSync: // Full sync: writes commit before returning.
      return 0;
    default:
      return raise(Errno.NotSupported);
  }
}

export function descriptorImports(fs: FileSystem): Record<string, GuestImport> {
  const checked = fs.checked.bind(fs);
  return {
    _open: checked((a) => openFile(fs, a(0), a(1)), -1, "open"),
    _read: checked((a) => readDescriptor(fs, a(0), a(1), a(Argument.Third))),
    _write: checked((a) => writeDescriptor(fs, a(0), a(1), a(Argument.Third))),
    _close: checked((a) => closeDescriptor(fs, a(0))),
    // iOS ARMv7 aligns 64-bit arguments on four-byte boundaries: fd=r0,
    // offset=r1:r2 (low:high), origin=r3. off_t returns in r0:r1.
    _lseek: checked(
      (a) =>
        seekDescriptor(
          fs,
          a(0),
          BigInt.asIntN(INT64_BITS, BigInt(a(1)) | (BigInt(a(Argument.Third)) << WORD_BITS)),
          a(Argument.Fourth),
        ),
      FAILED_OFFSET,
    ),
    _fcntl: checked((a) => fcntl(fs, a)),
    _stat: checked(
      async (a) => {
        if (!a(0) || !a(1)) raise(Errno.Fault);
        fs.cpu.write(a(1), statBytes(await pathStat(fs, fs.locate(a(0)))));
        return 0;
      },
      -1,
      "stat",
    ),
    _fstat: checked(async (a) => {
      if (!a(1)) raise(Errno.Fault);
      fs.cpu.write(a(1), statBytes(await descriptorStat(fs, a(0))));
      return 0;
    }),
    _fsync: checked((a) => {
      fs.fdFor(a(0));
      return 0;
    }), // writes await transaction completion
  };
}
