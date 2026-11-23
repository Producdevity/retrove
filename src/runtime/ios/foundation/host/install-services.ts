import { installPaymentQueue } from "../../storekit/payment-queue";
import { installPasteboards } from "../../uikit/pasteboard";
import { installCalendars } from "../calendar/bindings";
import { installDates } from "../dates";
import { installUserDefaults } from "../user-defaults";
import {
  DataField,
  MILLISECONDS_PER_SECOND,
  PHYSICAL_MEMORY_BYTES,
  PROCESSOR_COUNT,
} from "./constants";
import { bundleIdentifier, preferenceDomain } from "./identity";
import type { FoundationContext } from "./types";

export function installServices(ctx: FoundationContext): void {
  const { hostClass, method, h, isKind } = ctx;
  const dates = installDates({
    hostClass,
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    retain: ctx.retain,
    autorelease: ctx.autorelease,
    isDate: (pointer) => isKind(pointer, "NSDate"),
  });
  ctx.late.dates.set(dates);
  installCalendars({
    hostClass,
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    autorelease: ctx.autorelease,
    retain: ctx.retain,
    release: ctx.release,
    text: ctx.text,
    string: ctx.string,
    write: ctx.write,
    referenceTime: dates.referenceTime,
    createDate: dates.create,
  });
  installPaymentQueue({
    hostClass,
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    retain: ctx.retain,
    release: ctx.release,
    autorelease: ctx.autorelease,
    text: ctx.text,
    string: ctx.string,
    write: ctx.write,
    array: ctx.array,
  });
  installPasteboards({
    hostClass,
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    retain: ctx.retain,
    release: ctx.release,
    autorelease: ctx.autorelease,
    text: ctx.text,
    string: ctx.string,
    write: ctx.write,
    isKind,
    items: ctx.items,
    property: h.property,
    identifier: bundleIdentifier(ctx.ipa),
    unique: () => crypto.randomUUID(),
    bytes: (pointer) =>
      ctx.cpu.read(ctx.read(pointer + DataField.Bytes), ctx.read(pointer + DataField.Length)),
    read: (key) => globalThis.localStorage?.getItem(key) ?? null,
    save: (key, value) => {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    },
  });
  installDefaults(ctx);
}

function installDefaults(ctx: FoundationContext): void {
  const { h, read, names } = ctx;
  const domain = preferenceDomain(ctx.ipa);
  installUserDefaults({
    hostClass: ctx.hostClass,
    method: ctx.method,
    text: ctx.text,
    string: ctx.string,
    singleton: h.singleton,
    property: h.property,
    plist: h.plist,
    identifier: bundleIdentifier(ctx.ipa),
    className: (pointer) => {
      const cls = pointer && read(pointer);
      return [...names].find(([, value]) => value === cls)?.[0] ?? "nil";
    },
    warn: (message, details) => {
      ctx.diagnostic("warn", "foundation", message, details);
    },
    globals: {
      AppleLanguages: h.languages(),
      AppleLocale: h.primaryLanguage().replaceAll("-", "_"),
    },
    storage: {
      read: () => {
        try {
          const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(domain) ?? "{}");
          return parsed;
        } catch {
          return {};
        }
      },
      write: (values) => {
        try {
          if (!globalThis.localStorage) return false;
          globalThis.localStorage.setItem(domain, JSON.stringify(values));
          return true;
        } catch {
          return false;
        }
      },
    },
  });
}

export function installProcessInfo(ctx: FoundationContext): void {
  const { method, h } = ctx;
  ctx.hostClass("NSProcessInfo", "NSObject");
  method("NSProcessInfo", true, "processInfo", h.singleton("NSProcessInfo"));
  method("NSProcessInfo", false, "physicalMemory", () => PHYSICAL_MEMORY_BYTES);
  for (const name of ["processorCount", "activeProcessorCount"]) {
    method("NSProcessInfo", false, name, () => PROCESSOR_COUNT);
  }
  method("NSProcessInfo", false, "systemUptime", () => {
    h.bits.setFloat64(0, performance.now() / MILLISECONDS_PER_SECOND, true);
    return h.bits.getBigUint64(0, true);
  });
  method("NSProcessInfo", false, "environment", () => h.property({}));
}
