import { afterEach, expect, test, vi } from "vite-plus/test";
class Lifetime extends Event {
  readonly pending: Promise<unknown>[] = [];
  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise);
  }
}
class FetchRequest extends Lifetime {
  response: Promise<Response> | undefined;
  constructor(readonly request: Request) {
    super("fetch");
  }
  respondWith(response: Promise<Response>): void {
    this.response = response;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function worker(failInstall = false) {
  const handlers = new Map<string, (event: Event) => void>();
  const entries = new Map<string, Response>();
  const deleted: string[] = [];
  const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("__RETROVE_ASSETS__", ["/index.html", "/player.html", "/runtime/cpu.mjs"]);
  vi.stubGlobal("__RETROVE_VERSION__", "test-build");
  vi.stubGlobal("location", { origin: "https://retrove.test" });
  vi.stubGlobal("addEventListener", (name: string, handler: (event: Event) => void) =>
    handlers.set(name, handler),
  );
  vi.stubGlobal("fetch", network);
  vi.stubGlobal("clients", { matchAll: async () => [], claim: async () => {} });
  vi.stubGlobal("skipWaiting", async () => {});
  vi.stubGlobal("caches", {
    open: async () => ({
      addAll: async (paths: string[]) => {
        if (failInstall) throw new Error("Storage full");
        for (const path of paths) entries.set(path, new Response(path));
      },
      match: async (path: string) => entries.get(path),
    }),
    keys: async () => ["retrove.shell:old-build", "retrove.shell:test-build", "unrelated-app"],
    delete: async (name: string) => {
      deleted.push(name);
      return true;
    },
  });
  await import("./worker");
  return { handlers, entries, deleted, network };
}
test("serves cached library and player shells offline without caching user archives", async () => {
  const state = await worker();
  const install = new Lifetime("install");
  state.handlers.get("install")?.(install);
  await Promise.all(install.pending);
  const library = new FetchRequest(new Request("https://retrove.test/"));
  state.handlers.get("fetch")?.(library);
  expect(await (await library.response)?.text()).toBe("/index.html");
  const player = new FetchRequest(
    new Request("https://retrove.test/player.html?app=ios%3Aexample"),
  );
  state.handlers.get("fetch")?.(player);
  expect(await (await player.response)?.text()).toBe("/player.html");
  const archive = new FetchRequest(new Request("https://retrove.test/user.ipa"));
  state.handlers.get("fetch")?.(archive);
  expect(archive.response).toBeUndefined();
  expect(state.network).not.toHaveBeenCalled();
});
test("activation removes only older Retrove shell caches", async () => {
  const state = await worker();
  const activate = new Lifetime("activate");
  state.handlers.get("activate")?.(activate);
  await Promise.all(activate.pending);
  expect(state.deleted).toEqual(["retrove.shell:old-build"]);
});
test("a failed install discards its incomplete cache and preserves the prior version", async () => {
  const state = await worker(true);
  const install = new Lifetime("install");
  state.handlers.get("install")?.(install);
  await expect(Promise.all(install.pending)).rejects.toThrow("Storage full");
  expect(state.deleted).toEqual(["retrove.shell:test-build"]);
});
test("cached shells and scripts carry isolation headers even when stored without them", async () => {
  const state = await worker();
  const install = new Lifetime("install");
  state.handlers.get("install")?.(install);
  await Promise.all(install.pending);
  state.entries.set("/assets/old.js", new Response("script"));
  const navigation = new Request("https://retrove.test/");
  Object.defineProperty(navigation, "mode", { value: "navigate" });
  const requests = [
    navigation,
    new Request("https://retrove.test/runtime/cpu.mjs"),
    new Request("https://retrove.test/assets/old.js"),
  ];
  for (const request of requests) {
    const event = new FetchRequest(request);
    state.handlers.get("fetch")?.(event);
    const response = await event.response;
    expect(response?.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response?.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
  }
});
