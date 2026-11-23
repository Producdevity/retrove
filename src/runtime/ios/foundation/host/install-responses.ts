import { Argument } from "../../objc/host";
import { installURLCache } from "../url-cache/bindings";
import { installURLConnections } from "../url-connection";
import { pointer as objectPointer } from "../operations/host";
import {
  BLOCK_INVOKE_OFFSET,
  DEFAULT_HTTP_STATUS,
  HttpStatusText,
  SUPPORTED_REQUEST_PROTOCOLS,
  UNKNOWN_CONTENT_LENGTH,
  UrlError,
} from "./constants";
import type { installOperationService } from "./install-requests";
import type { FoundationContext } from "./types";

const RESPONSE = "NSURLResponse";
const HTTP_RESPONSE = "NSHTTPURLResponse";
const CONNECTION = "NSURLConnection";

interface LoadResult {
  data?: number;
  response?: number;
  error?: number;
}

export function installResponses(ctx: FoundationContext): void {
  const { method, hostClass, state, h, string, retain, release, destroy, autorelease } = ctx;
  hostClass(CONNECTION, "NSObject");
  hostClass(RESPONSE, "NSObject");
  method(RESPONSE, false, "copy", retain);
  installURLCache({
    hostClass,
    method,
    alloc: ctx.alloc,
    destroy,
    retain,
    release,
    autorelease,
    text: ctx.text,
    string,
    write: ctx.write,
    send: async (pointer, selector, args) => objectPointer(await ctx.send(pointer, selector, args)),
  });
  method(RESPONSE, false, "URL", (self) => state.responses.get(self)?.url ?? 0);
  method(RESPONSE, false, "expectedContentLength", (self) =>
    BigInt(state.responses.get(self)?.length ?? UNKNOWN_CONTENT_LENGTH),
  );
  hostClass(HTTP_RESPONSE, RESPONSE);
  method(
    HTTP_RESPONSE,
    false,
    "statusCode",
    (self) => state.responses.get(self)?.status ?? DEFAULT_HTTP_STATUS,
  );
  method(HTTP_RESPONSE, false, "allHeaderFields", () =>
    autorelease(h.dictionary(h.classPointer("NSDictionary"), [])),
  );
  method(HTTP_RESPONSE, true, "localizedStringForStatusCode:", (_, args) =>
    string(HttpStatusText[args(0)] ?? "unknown"),
  );
  method(RESPONSE, false, "dealloc", async (self) => {
    const record = state.responses.get(self);
    state.responses.delete(self);
    if (record) await release(record.url);
    destroy(self);
  });
}

function createLoader(ctx: FoundationContext): (request: number) => Promise<LoadResult> {
  const { state, h, send, string, autorelease, alloc, retain } = ctx;
  return async (request) => {
    const url = state.requests.get(request);
    const target = url === undefined ? undefined : state.urls.get(url);
    if (url === undefined || target?.protocol !== "file:") {
      return { error: autorelease(h.offlineError(UrlError.Offline, url)) };
    }
    const data = await send(h.classPointer("NSData"), "dataWithContentsOfFile:", [
      string(decodeURIComponent(target.pathname)),
    ]);
    if (typeof data !== "number" || !data) {
      return { error: autorelease(h.offlineError(UrlError.MissingFile, url)) };
    }
    const response = alloc(h.classPointer(RESPONSE));
    const length = await send(data, "length");
    state.responses.set(response, {
      url: retain(url),
      length: typeof length === "number" || typeof length === "bigint" ? length : undefined,
    });
    return { data, response: autorelease(response) };
  };
}

export function installConnections(
  ctx: FoundationContext,
  operations: ReturnType<typeof installOperationService>,
) {
  const { method, state, send, read, write, retain, release, threads } = ctx;
  const load = createLoader(ctx);
  const connections = installURLConnections({
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    autorelease: ctx.autorelease,
    retain,
    release,
    text: ctx.text,
    supported: (request) => {
      const requestUrl = state.requests.get(request);
      const target = requestUrl === undefined ? undefined : state.urls.get(requestUrl);
      return !!target && SUPPORTED_REQUEST_PROTOCOLS.includes(target.protocol);
    },
    currentLoop: () => ctx.getRunLoop(),
    load,
    notify: async (delegate, selector, args) => {
      await send(delegate, selector, args, true);
    },
  });
  method(CONNECTION, true, "sendAsynchronousRequest:queue:completionHandler:", async (_, args) => {
    const handler = args(Argument.Third);
    if (!handler) return;
    const { response = 0, data = 0, error = 0 } = await load(args(0));
    const dispatch = ctx.getDispatch();
    if (!dispatch) throw new Error("Dispatch services are unavailable");
    const block = await dispatch.copy(handler);
    const blockArgs = [block, retain(response), retain(data), retain(error)];
    const done = async () => {
      await dispatch.release(block);
      for (const pointer of blockArgs.slice(1)) await release(pointer);
    };
    const entry = read(block + BLOCK_INVOKE_OFFSET);
    if (args(1) === operations.main()) {
      state.mainRequests.push(async () => {
        try {
          await ctx.callBlock(entry, blockArgs);
        } finally {
          await done();
        }
      });
    } else if (!threads?.spawnDetached(entry, blockArgs, done)) {
      await done();
      throw new Error("NSOperationQueue worker allocation failed");
    }
  });
  method(CONNECTION, true, "sendSynchronousRequest:returningResponse:error:", async (_, args) => {
    const outResponse = args(1);
    const outError = args(Argument.Third);
    const { response = 0, data = 0, error = 0 } = await load(args(0));
    if (outResponse) write(outResponse, response);
    if (outError) write(outError, error);
    return data;
  });
  return connections;
}
