import { ErrorField, ErrorInfo } from "../errors";
import { ErrorDomain, UrlError } from "./constants";
import type { FoundationBase, Helpers } from "./types";

type UrlHelpers = Pick<
  Helpers,
  "url" | "fileURL" | "offlineError" | "newUUID" | "uuidString" | "forgetUUID"
>;
type Core = Pick<Helpers, "classPointer" | "dictionary">;

export function createUrls(base: FoundationBase, core: Core): UrlHelpers {
  const { state, alloc, autorelease, write, retain, string, ipa } = base;
  const url: Helpers["url"] = (value, cls = core.classPointer("NSURL")) => {
    const pointer = alloc(cls);
    state.urls.set(pointer, value);
    return autorelease(pointer);
  };
  const fileURL: Helpers["fileURL"] = (path) => {
    const absolute = path.startsWith("/") ? path : `/${ipa.bundlePath}/${path}`;
    const result = new URL("file:///");
    result.pathname = absolute;
    return result;
  };
  const offlineError: Helpers["offlineError"] = (code = UrlError.Offline, target = 0) => {
    const error = alloc(core.classPointer("NSError"));
    write(error + ErrorField.Code, code);
    write(error + ErrorField.Domain, retain(string(ErrorDomain.URL)));
    if (target) {
      const info = core.dictionary(core.classPointer("NSDictionary"), [
        [string(ErrorInfo.FailingURL), target],
        [string(ErrorInfo.FailingURLString), string(state.urls.get(target)?.href ?? "")],
      ]);
      write(error + ErrorField.UserInfo, info);
    }
    return error;
  };
  const uuids = new Map<number, string>();
  const newUUID: Helpers["newUUID"] = (value) => {
    const pointer = alloc(core.classPointer("NSUUID"));
    uuids.set(pointer, (value ?? crypto.randomUUID()).toUpperCase());
    return pointer;
  };
  return {
    url,
    fileURL,
    offlineError,
    newUUID,
    uuidString: (pointer) => {
      const value = uuids.get(pointer);
      if (value === undefined) throw new Error("Unknown NSUUID");
      return value;
    },
    forgetUUID: (pointer) => {
      uuids.delete(pointer);
    },
  };
}
