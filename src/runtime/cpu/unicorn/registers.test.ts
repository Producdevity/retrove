import { expect, test } from "vite-plus/test";
import { UnicornRegisters } from "./registers";
test("register transfers refresh their memory view after growth and propagate native failures", () => {
  let memory = new Uint32Array(4),
    value = 0,
    status = 0,
    freed = 0;
  const module = {
    get HEAPU32() {
      return memory;
    },
    ERR_OK: 0,
    _malloc: () => 4,
    _free: () => {
      freed++;
    },
    _uc_reg_read: () => {
      memory = new Uint32Array(8);
      memory[1] = value;
      return status;
    },
    _uc_reg_write: () => {
      value = memory[1] ?? 0;
      return status;
    },
    strerror: () => "unavailable",
  };
  const registers = new UnicornRegisters(module, 1);
  registers.write(0, 0xffffffff);
  expect(registers.read(0)).toBe(0xffffffff);
  status = 2;
  expect(() => registers.read(0)).toThrow(/unavailable/);
  expect(() => registers.write(0, 0)).toThrow(/unavailable/);
  registers.close();
  registers.close();
  expect(freed).toBe(1);
  expect(() => registers.read(0)).toThrow(/closed/);
  expect(() => registers.write(0, 0)).toThrow(/closed/);
  expect(() => new UnicornRegisters({ ...module, _malloc: () => 0 }, 1)).toThrow(/allocate/);
});
