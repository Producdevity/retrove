import { Argument } from "../../objc/host";
import { localeComponent } from "../locale-components";
import { ErrorField } from "../errors";
import {
  ErrorDomain,
  JSON_INDENT,
  JSON_PRETTY_PRINTED,
  JSON_READ_CORRUPT_ERROR,
} from "./constants";
import type { FoundationContext } from "./types";

export function installNullAndJson(ctx: FoundationContext): void {
  const { method, hostClass, h, string, isKind } = ctx;
  hostClass("NSNull", "NSObject");
  method("NSNull", true, "null", h.singleton("NSNull"));
  method("NSNull", false, "copy", ctx.retain);
  method("NSNull", false, "description", () => string("<null>"));
  hostClass("NSJSONSerialization", "NSObject");
  const validJSON = (pointer: number): boolean => {
    try {
      return isKind(pointer, "NSArray") || isKind(pointer, "NSDictionary")
        ? JSON.stringify(h.unbox(pointer)) !== undefined
        : false;
    } catch {
      return false;
    }
  };
  method("NSJSONSerialization", true, "isValidJSONObject:", (_, args) =>
    Number(validJSON(args(0))),
  );
  method("NSJSONSerialization", true, "dataWithJSONObject:options:error:", (_, args) => {
    const source = args(0);
    const options = args(1);
    const out = args(Argument.Third);
    if (!validJSON(source)) {
      if (out) {
        const error = ctx.alloc(h.classPointer("NSError"));
        ctx.write(error + ErrorField.Code, JSON_READ_CORRUPT_ERROR);
        ctx.write(error + ErrorField.Domain, ctx.retain(string(ErrorDomain.Cocoa)));
        ctx.write(out, ctx.autorelease(error));
      }
      return 0;
    }
    const indent = options & JSON_PRETTY_PRINTED ? JSON_INDENT : 0;
    const data = new TextEncoder().encode(JSON.stringify(h.unbox(source), null, indent));
    const pointer = ctx.heap.alloc(data.length);
    try {
      ctx.cpu.write(pointer, data);
      return ctx.autorelease(ctx.dataFrom(pointer, data.length));
    } finally {
      ctx.heap.free(pointer);
    }
  });
}

export function installLocales(ctx: FoundationContext): void {
  const { method, hostClass, h, string, text, alloc, autorelease } = ctx;
  hostClass("NSLocale", "NSObject");
  const identifier = () => h.primaryLanguage().replaceAll("-", "_");
  method("NSLocale", true, "preferredLanguages", () =>
    autorelease(ctx.array(h.languages().map((language) => string(language)))),
  );
  method("NSLocale", true, "currentLocale", h.singleton("NSLocale"));
  const localeIds = new Map<number, string>();
  method("NSLocale", false, "localeIdentifier", (self) =>
    string(localeIds.get(self) ?? identifier()),
  );
  method("NSLocale", false, "initWithLocaleIdentifier:", (self, args) => {
    if (args(0)) localeIds.set(self, text(args(0)));
    return self;
  });
  method("NSLocale", true, "localeWithLocaleIdentifier:", (cls, args) => {
    const self = alloc(cls);
    if (args(0)) localeIds.set(self, text(args(0)));
    return autorelease(self);
  });
  for (const name of ["systemLocale", "autoupdatingCurrentLocale"]) {
    method("NSLocale", true, name, h.singleton("NSLocale"));
  }
  method("NSLocale", false, "objectForKey:", (self, args) => {
    const value = args(0)
      ? localeComponent(localeIds.get(self) ?? identifier(), text(args(0)))
      : undefined;
    return value === undefined ? 0 : string(value);
  });
}
