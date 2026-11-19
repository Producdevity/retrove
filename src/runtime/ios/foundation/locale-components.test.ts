import { describe, expect, it } from "vite-plus/test";
import { LocaleKey, localeComponent } from "./locale-components";

describe("localeComponent", () => {
  it("splits language, script and country", () => {
    expect(localeComponent("zh_Hant_TW", LocaleKey.LanguageCode)).toBe("zh");
    expect(localeComponent("zh_Hant_TW", LocaleKey.ScriptCode)).toBe("Hant");
    expect(localeComponent("zh_Hant_TW", LocaleKey.CountryCode)).toBe("TW");
    expect(localeComponent("en-us", LocaleKey.CountryCode)).toBe("US");
  });
  it("has no country for a bare language", () => {
    expect(localeComponent("fr", LocaleKey.CountryCode)).toBeUndefined();
    expect(localeComponent("fr", "unknown")).toBeUndefined();
  });
});
