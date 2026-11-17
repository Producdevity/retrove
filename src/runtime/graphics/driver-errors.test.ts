import { expect, test, vi } from "vite-plus/test";
import { GLErrorState } from "./driver-errors";

const INVALID_ENUM = 0x0500,
  INVALID_OPERATION = 0x0502,
  OUT_OF_MEMORY = 0x0505;

test("the first emulated error is reported once and before the driver", () => {
  const errors = new GLErrorState(),
    driver = vi.fn(() => OUT_OF_MEMORY);
  errors.record(INVALID_ENUM);
  errors.record(INVALID_OPERATION);
  expect(errors.take(driver, 0)).toBe(INVALID_ENUM);
  expect(driver).not.toHaveBeenCalled();
  expect(errors.take(driver, 1)).toBe(OUT_OF_MEMORY);
});

test("driver queries are sampled once per display interval", () => {
  const errors = new GLErrorState(),
    driver = vi.fn(() => 0);
  errors.take(driver, 100);
  errors.take(driver, 110);
  expect(driver).toHaveBeenCalledTimes(1);
  errors.take(driver, 116);
  expect(driver).toHaveBeenCalledTimes(2);
});

test("an emulated error is reported even inside the sampling window", () => {
  const errors = new GLErrorState(),
    driver = vi.fn(() => 0);
  errors.take(driver, 100);
  errors.record(INVALID_OPERATION);
  expect(errors.take(driver, 101)).toBe(INVALID_OPERATION);
});
