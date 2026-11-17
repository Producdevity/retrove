import { expect, test } from "vite-plus/test";
import type { HostMethod } from "../../objc/host";
import { browserURL, installURLOpening } from "./url-opening";

test("web, mail and App Store links map to browser URLs", () => {
  expect(browserURL("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
  expect(browserURL("itms-apps://itunes.apple.com/app/id1?mt=8")).toBe(
    "https://itunes.apple.com/app/id1?mt=8",
  );
  expect(browserURL("fb://profile")).toBeUndefined();
  expect(browserURL("not a url")).toBeUndefined();
});

test("openURL: opens supported links and reports unsupported ones", async () => {
  const methods = new Map<string, HostMethod>(),
    opened: string[] = [];
  const urls = new Map([
    [1, "itms://itunes.apple.com/app/id9"],
    [2, "tel:123"],
  ]);
  installURLOpening({
    method: (_, __, selector, implementation) => methods.set(selector, implementation),
    send: async (receiver) => receiver,
    text: (pointer) => urls.get(pointer) ?? "",
    open: (address) => opened.push(address) > 0,
  });
  const call = (selector: string, url: number) => methods.get(selector)?.(0, () => url);
  expect(await call("openURL:", 1)).toBe(1);
  expect(await call("canOpenURL:", 2)).toBe(0);
  expect(await call("openURL:", 2)).toBe(0);
  expect(await call("openURL:", 0)).toBe(0);
  expect(opened).toEqual(["https://itunes.apple.com/app/id9"]);
});
