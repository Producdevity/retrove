/** When the cooperative scheduler takes the CPU from a guest thread. */
export const Scheduling = {
  /** After a few host calls or an instruction budget, as well as when it blocks. */
  Slices: "slices",
  /** Only when it blocks, yields or exits. */
  Blocks: "blocks",
} as const;
export type Scheduling = (typeof Scheduling)[keyof typeof Scheduling];

/** The tester's setting: follow each game's preset, or force one scheduling for every game. */
export const SchedulingChoice = { Game: "game", ...Scheduling } as const;
export type SchedulingChoice = (typeof SchedulingChoice)[keyof typeof SchedulingChoice];

const KEY = "retrove.scheduling";
const choices: readonly string[] = Object.values(SchedulingChoice);
const isChoice = (value: string | null): value is SchedulingChoice =>
  value !== null && choices.includes(value);

export function schedulingChoice(): SchedulingChoice {
  try {
    const stored = globalThis.localStorage?.getItem(KEY) ?? null;
    return isChoice(stored) ? stored : SchedulingChoice.Game;
  } catch {
    return SchedulingChoice.Game;
  }
}

/** Records the tester's choice; the next launch uses it. */
export function setSchedulingChoice(choice: SchedulingChoice): void {
  if (choice === SchedulingChoice.Game) globalThis.localStorage?.removeItem(KEY);
  else globalThis.localStorage?.setItem(KEY, choice);
}

export function resolveScheduling(
  preset: Scheduling | undefined,
  choice: SchedulingChoice = schedulingChoice(),
): Scheduling {
  if (choice !== SchedulingChoice.Game) return choice;
  return preset ?? Scheduling.Slices;
}
