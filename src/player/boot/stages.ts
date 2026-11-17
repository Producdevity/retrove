import { isRecord } from "../../domain/validation";
import { formatBytes } from "../../ui/format";

export const Stage = { Unpack: 0, Link: 1, Start: 2, Frame: 3 } as const;
export type Stage = (typeof Stage)[keyof typeof Stage];
export const STAGE_TITLES: Readonly<Record<Stage, string>> = {
  [Stage.Unpack]: "Unpacking",
  [Stage.Link]: "Linking",
  [Stage.Start]: "Starting",
  [Stage.Frame]: "Waiting for the first frame",
};
const LINK_STEPS = [
  "Read executable",
  "Parse ARM Mach-O",
  "Initialize ARM WebAssembly CPU",
  "Map segments and bind imports",
  "Install Objective-C metadata",
];
const INITIALIZER = /^initializer (?<done>\d+)\/(?<total>\d+)/u;
const ENTRY = "Application entry";
const LOAD = "Objective-C +load";

export interface BootSignal {
  readonly stage: Stage;
  /** Known progress through the stage, or undefined when the runtime cannot tell. */
  readonly progress: number | undefined;
  readonly detail: string;
}
function count(details: unknown, key: string): number | undefined {
  return isRecord(details) && typeof details[key] === "number" ? details[key] : undefined;
}
const LINK_DETAILS: Readonly<Record<string, (details: unknown) => string>> = {
  "Read executable": () => "Reading the executable",
  "Parse ARM Mach-O": () => "Parsing ARM code",
  "Initialize ARM WebAssembly CPU": (details) => {
    const imports = count(details, "imports");
    return imports === undefined
      ? "Preparing the ARM CPU"
      : `Preparing the ARM CPU · ${imports.toLocaleString()} imports`;
  },
  "Map segments and bind imports": () => "Mapping memory and binding imports",
  "Install Objective-C metadata": (details) => {
    const initializers = count(details, "initializers");
    return initializers === undefined
      ? "Installing Objective-C classes"
      : `Installing Objective-C classes · ${initializers.toLocaleString()} initializers`;
  },
};

/** Reads a runtime diagnostic as a step of the boot sequence, when it is one. */
export function bootSignal(
  area: string,
  message: string,
  details: unknown,
): BootSignal | undefined {
  if (area === "ipa" && message === "Extracting app executable") {
    const bytes = count(details, "bytes");
    return {
      stage: Stage.Unpack,
      progress: undefined,
      detail:
        bytes === undefined ? "Extracting the app" : `Extracting the app · ${formatBytes(bytes)}`,
    };
  }
  if (area !== "guest") return undefined;
  const step = LINK_STEPS.indexOf(message);
  const link = LINK_DETAILS[message];
  if (step >= 0 && link)
    return { stage: Stage.Link, progress: step / LINK_STEPS.length, detail: link(details) };
  if (message === LOAD) return { stage: Stage.Start, progress: 0, detail: "Running +load methods" };
  const initializer = INITIALIZER.exec(message);
  if (initializer) {
    const done = Number(initializer.groups?.["done"]),
      total = Number(initializer.groups?.["total"]);
    return {
      stage: Stage.Start,
      progress: total ? done / total : undefined,
      detail: `Initializer ${done.toLocaleString()} of ${total.toLocaleString()}`,
    };
  }
  if (message.startsWith(ENTRY))
    return { stage: Stage.Frame, progress: undefined, detail: "Entering the app" };
  return undefined;
}
