/** NSLocale component keys share their values with the CFLocale keys they bridge to. */
export const LocaleKey = {
  Identifier: "kCFLocaleIdentifierKey",
  LanguageCode: "kCFLocaleLanguageCodeKey",
  CountryCode: "kCFLocaleCountryCodeKey",
  ScriptCode: "kCFLocaleScriptCodeKey",
} as const;
export const LocaleSymbols: Readonly<Record<string, string>> = {
  _NSLocaleIdentifier: LocaleKey.Identifier,
  _NSLocaleLanguageCode: LocaleKey.LanguageCode,
  _NSLocaleCountryCode: LocaleKey.CountryCode,
  _NSLocaleScriptCode: LocaleKey.ScriptCode,
};

/** A component of an ICU locale identifier such as "en_US" or "zh_Hant_TW". */
export function localeComponent(identifier: string, key: string): string | undefined {
  const parts = identifier.split(/[_-]/u).filter(Boolean);
  const [language] = parts;
  const script = parts.slice(1).find((part) => /^[A-Za-z]{4}$/u.test(part));
  const country = parts.slice(1).find((part) => /^(?:[A-Za-z]{2}|\d{3})$/u.test(part));
  switch (key) {
    case LocaleKey.Identifier:
      return identifier;
    case LocaleKey.LanguageCode:
      return language?.toLowerCase();
    case LocaleKey.CountryCode:
      return country?.toUpperCase();
    case LocaleKey.ScriptCode:
      return script;
    default:
      return undefined;
  }
}
