import { Argument, type FoundationHost } from "../objc/host";

export interface NumberFormatterHost extends FoundationHost {
  /** The numeric value of an NSNumber, or undefined for anything else. */
  numberValue(pointer: number): number | undefined;
  /** An autoreleased NSNumber. */
  number(value: number): number;
}
/** NSNumberFormatterStyle. */
const Style = { None: 0, Decimal: 1, Currency: 2, Percent: 3, Scientific: 4, SpellOut: 5 } as const;
const CLASS = "NSNumberFormatter";
const PERCENT = 100;
/** NSNumberFormatterDecimalStyle shows up to three fraction digits. */
const DECIMAL_DIGITS = 3;
interface State {
  style: number;
  minimumFraction: number | undefined;
  maximumFraction: number | undefined;
  grouping: boolean | undefined;
  currency: string;
}

export function formatNumber(state: State, value: number): string {
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits:
      state.maximumFraction ?? (state.style === Style.Decimal ? DECIMAL_DIGITS : 0),
    minimumFractionDigits: state.minimumFraction ?? 0,
  };
  if (state.style === Style.Currency)
    Object.assign(options, { style: "currency", currency: state.currency });
  if (state.style === Style.Percent) options.style = "percent";
  if (state.style === Style.Scientific) options.notation = "scientific";
  options.useGrouping = state.grouping ?? state.style !== Style.None;
  if (state.style === Style.Currency) delete options.maximumFractionDigits;
  if (options.minimumFractionDigits !== undefined && options.maximumFractionDigits !== undefined)
    options.maximumFractionDigits = Math.max(
      options.minimumFractionDigits,
      options.maximumFractionDigits,
    );
  return new Intl.NumberFormat(undefined, options).format(value);
}
export function parseNumber(state: State, text: string): number | undefined {
  const cleaned = text.replace(/[^\d.,eE+-]/gu, "").replace(/,/gu, "");
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return undefined;
  return state.style === Style.Percent ? value / PERCENT : value;
}

/** NSNumberFormatter over Intl.NumberFormat in the device locale. */
export function installNumberFormatter(host: NumberFormatterHost): void {
  host.hostClass(CLASS, "NSObject");
  const states = new Map<number, State>();
  const get = (self: number): State => {
    let state = states.get(self);
    if (!state) {
      state = {
        style: Style.None,
        minimumFraction: undefined,
        maximumFraction: undefined,
        grouping: undefined,
        currency: "USD",
      };
      states.set(self, state);
    }
    return state;
  };
  host.method(CLASS, false, "init", (self) => {
    get(self);
    return self;
  });
  host.method(CLASS, false, "setNumberStyle:", (self, args) => {
    get(self).style = args(Argument.First);
  });
  host.method(CLASS, false, "numberStyle", (self) => get(self).style);
  host.method(CLASS, false, "setMinimumFractionDigits:", (self, args) => {
    get(self).minimumFraction = args(Argument.First);
  });
  host.method(CLASS, false, "setMaximumFractionDigits:", (self, args) => {
    get(self).maximumFraction = args(Argument.First);
  });
  host.method(CLASS, false, "setUsesGroupingSeparator:", (self, args) => {
    get(self).grouping = Boolean(args(Argument.First));
  });
  host.method(CLASS, false, "setCurrencyCode:", (self, args) => {
    if (args(Argument.First)) get(self).currency = host.text(args(Argument.First));
  });
  for (const ignored of [
    "setFormatterBehavior:",
    "setLocale:",
    "setGroupingSeparator:",
    "setDecimalSeparator:",
    "setGeneratesDecimalNumbers:",
    "setRoundingMode:",
    "setPositiveFormat:",
    "setNegativeFormat:",
  ])
    host.method(CLASS, false, ignored, () => undefined);
  host.method(CLASS, false, "stringFromNumber:", (self, args) => {
    const value = host.numberValue(args(Argument.First));
    return value === undefined ? 0 : host.string(formatNumber(get(self), value));
  });
  host.method(CLASS, false, "numberFromString:", (self, args) => {
    const value = args(Argument.First)
      ? parseNumber(get(self), host.text(args(Argument.First)))
      : undefined;
    return value === undefined ? 0 : host.number(value);
  });
  host.method(CLASS, true, "localizedStringFromNumber:numberStyle:", (_self, args) => {
    const value = host.numberValue(args(Argument.First));
    if (value === undefined) return 0;
    return host.string(
      formatNumber(
        {
          style: args(Argument.Second),
          minimumFraction: undefined,
          maximumFraction: undefined,
          grouping: undefined,
          currency: "USD",
        },
        value,
      ),
    );
  });
  host.method(CLASS, false, "dealloc", (self) => {
    states.delete(self);
    host.destroy(self);
  });
}
