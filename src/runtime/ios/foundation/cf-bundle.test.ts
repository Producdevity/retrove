import { expect, test } from "vite-plus/test";
import { bundleVersionNumber } from "./cf-bundle";

test("CFBundleGetVersionNumber packs BCD fields with a release stage", () => {
  expect(bundleVersionNumber("1.0.2").toString(16)).toBe("1028000");
  expect(bundleVersionNumber("12.3").toString(16)).toBe("12308000");
  expect(bundleVersionNumber("2").toString(16)).toBe("2008000");
});

test("unrepresentable versions read as zero", () => {
  expect(bundleVersionNumber("1.10.0")).toBe(0);
  expect(bundleVersionNumber("beta")).toBe(0);
  expect(bundleVersionNumber(undefined)).toBe(0);
});
