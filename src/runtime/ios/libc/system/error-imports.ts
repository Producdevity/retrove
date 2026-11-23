import { read32, readString, type GuestMemory, type Heap } from "../../../memory/guest-memory";
import { Argument } from "../../objc/host";
import type { FileImports } from "../files";
import { errorText } from "./errno-text";
import type { SystemImport } from "./types";

const COMMAND_INTERPRETER_MISSING = 0x7f00;
const STDERR = 2;

export function errorImports(
  cpu: GuestMemory,
  heap: Heap,
  errno: number,
  files: FileImports,
): Record<string, SystemImport> {
  const messages = new Map<number, number>();
  return {
    ___error: () => errno,
    _strerror: (a) => {
      const code = a(0) | 0;
      if (!messages.has(code)) messages.set(code, heap.string(errorText(code)));
      return messages.get(code);
    },
    _perror: async (a) => {
      const prefix = a(0) ? readString(cpu, a(0)) : "";
      await files.writeBytes(
        STDERR,
        new TextEncoder().encode(
          `${prefix ? `${prefix}: ` : ""}${errorText(read32(cpu, errno))}\n`,
        ),
      );
    },
    ___assert_rtn: (a) => {
      throw Error(
        `Guest assertion failed: ${readString(cpu, a(Argument.Fourth))} (${readString(cpu, a(1))}:${a(Argument.Third)}, ${a(0) ? readString(cpu, a(0)) : "?"})`,
      );
    },
    _system: (a) => (a(0) ? COMMAND_INTERPRETER_MISSING : 0), // This browser process has no command interpreter.
    _sched_yield: () => {
      let yielded = false;
      return {
        wait() {
          if (yielded) return 0;
          yielded = true;
          return undefined;
        },
      };
    },
  };
}
