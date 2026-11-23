import { MAX_EXPRESSION_PREVIEW, NAVIGATION_TYPE_OTHER, UrlError } from "./constants";
import type { FoundationContext } from "./types";

const WEB_VIEW = "UIWebView";
const SHOULD_START = "webView:shouldStartLoadWithRequest:navigationType:";
interface WebLoad {
  req: number;
  loading: boolean;
  cancelled?: boolean;
}

export function installWebViews(ctx: FoundationContext): void {
  const { method, hostClass, state, text, string, send, h } = ctx;
  hostClass(WEB_VIEW, "UIView");
  const delegates = new Map<number, number>();
  const loads = new Map<number, WebLoad>();
  const delegateOf = (self: number) => delegates.get(self) ?? 0;
  method(WEB_VIEW, false, "setDelegate:", (self, args) => {
    delegates.set(self, args(0));
  });
  method(WEB_VIEW, false, "delegate", delegateOf);
  method(WEB_VIEW, false, "request", (self) => loads.get(self)?.req ?? 0);
  method(WEB_VIEW, false, "stopLoading", (self) => {
    const load = loads.get(self);
    if (load) load.cancelled = true;
  });
  method(WEB_VIEW, false, "isLoading", (self) => Number(!!loads.get(self)?.loading));
  const begin = (self: number, request: number): WebLoad => {
    const previous = loads.get(self);
    if (previous) previous.cancelled = true;
    const item: WebLoad = { req: request, loading: true };
    loads.set(self, item);
    return item;
  };
  method(WEB_VIEW, false, "loadHTMLString:baseURL:", (self, args) => {
    const html = text(args(0));
    const base = state.urls.get(args(1))?.href ?? "about:blank";
    const item = begin(self, 0);
    state.mainRequests.push(async () => {
      if (item.cancelled) return;
      await send(delegateOf(self), "webViewDidStartLoad:", [self], true);
      ctx.webViews.load(self, html, base, () => {
        state.mainRequests.push(async () => {
          if (item.cancelled) return;
          item.loading = false;
          await send(delegateOf(self), "webViewDidFinishLoad:", [self], true);
        });
      });
    });
  });
  method(WEB_VIEW, false, "loadRequest:", (self, args) => {
    const request = args(0);
    const item = begin(self, ctx.retain(request));
    state.mainRequests.push(() => runRequest(ctx, () => delegateOf(self), self, request, item));
  });
  method(WEB_VIEW, false, "stringByEvaluatingJavaScriptFromString:", (_, args) => {
    const expression = text(args(0))
      .trim()
      .replace(/;$/, "")
      .replace(/^window\./, "");
    if (expression === "navigator.userAgent") return string(globalThis.navigator?.userAgent ?? "");
    if (expression === "navigator.language") return string(h.primaryLanguage());
    throw new Error(
      `Unsupported guest UIWebView expression: ${expression.slice(0, MAX_EXPRESSION_PREVIEW)}`,
    );
  });
}

async function runRequest(
  ctx: FoundationContext,
  delegateOf: () => number,
  view: number,
  request: number,
  item: WebLoad,
): Promise<void> {
  const { state, send, lookup, read } = ctx;
  if (item.cancelled) return;
  const delegate = delegateOf();
  const target = state.requests.get(request);
  const url = target === undefined ? undefined : state.urls.get(target);
  if (delegate && lookup(read(delegate), SHOULD_START)) {
    const allowed = await send(delegate, SHOULD_START, [view, request, NAVIGATION_TYPE_OTHER]);
    if (!allowed) {
      item.loading = false;
      return;
    }
  }
  await send(delegate, "webViewDidStartLoad:", [view], true);
  item.loading = false;
  if (!url || url.href === "about:blank") {
    await send(delegate, "webViewDidFinishLoad:", [view], true);
    return;
  }
  const error = ctx.h.offlineError(UrlError.Offline, target);
  try {
    await send(delegate, "webView:didFailLoadWithError:", [view, error], true);
  } finally {
    await ctx.release(error);
  }
}
