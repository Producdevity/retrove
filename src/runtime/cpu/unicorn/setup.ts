import { ExecutionBudget } from "../execution-budget";
import { TciTier } from "../tci/tier";
import { saveTranslationProfile } from "../translation/profile-storage";
import { RegisterBridge } from "../translation/register-bridge";
import { TranslatedTier } from "../translation/tier";
import type { TranslationProfile } from "../translation/translation-profile";
import { deviceBudget } from "../../memory/device-budget";
import { UnicornBudget } from "./budget";
import { UnicornContexts } from "./contexts";
import { openEngine, type LoadedUnicorn, type UnicornEngine, type UnicornModule } from "./module";
import { UnicornRegisters } from "./registers";

/** One Wasm staging allocation for host transfers; Unicorn.js would copy byte by byte. */
export const COPY_CHUNK = 1_048_576;

export interface UnicornTranslation {
  readonly tier: TranslatedTier;
  readonly bridge: RegisterBridge;
}
/** Everything one Unicorn guest CPU owns. */
export interface UnicornParts {
  readonly uc: UnicornModule;
  readonly engine: UnicornEngine;
  readonly handle: number;
  readonly transfer: number;
  readonly registerTransfer: UnicornRegisters;
  /** Unicorn ids of r0-r15. */
  readonly registers: readonly number[];
  readonly compiler: TciTier | undefined;
  readonly translation: UnicornTranslation | undefined;
  readonly blocks: UnicornBudget | undefined;
  readonly states: UnicornContexts<number>;
}
export interface UnicornSetup {
  readonly budget: ExecutionBudget;
  readonly compilationThreshold: number;
  readonly translation: boolean;
  readonly profile: TranslationProfile | undefined;
  readonly profileKey: string | undefined;
}

function translated(
  { uc, core, doubles }: LoadedUnicorn,
  handle: number,
  registers: UnicornRegisters,
  { profile, profileKey }: UnicornSetup,
): UnicornTranslation {
  // Translated functions share guest memory with Unicorn (uc_mem_map_ptr) and fall back to it for
  // everything they cannot run: host traps, unsupported instructions and unrepresentable state.
  const tier = new TranslatedTier(uc, {
    profile,
    cache: profileKey,
    codeBudget: deviceBudget().codeBytes,
    onProfile: profileKey ? (p) => saveTranslationProfile(profileKey, p) : undefined,
  });
  const ids = {
    core,
    doubles,
    cpsr: uc.ARM_REG_CPSR,
    fpscr: uc.ARM_REG_FPSCR,
    pc: uc.ARM_REG_PC,
    threadPointer: uc.ARM_REG_C13_C0_3,
  };
  const bridge = new RegisterBridge(
    uc,
    handle,
    registers,
    ids,
    () => tier.layout,
    () => tier.pages.view,
  );
  return { tier, bridge };
}

export function openUnicorn(loaded: LoadedUnicorn, setup: UnicornSetup): UnicornParts {
  const { uc } = loaded;
  const threshold = setup.compilationThreshold;
  const compiler = threshold === 0 ? undefined : new TciTier(uc, threshold);
  const engine = openEngine(uc);
  const handle = uc.getValue(engine.handle_ptr, "*");
  const transfer = uc._malloc(COPY_CHUNK);
  if (!transfer) {
    engine.close();
    throw new Error("Unable to allocate the guest memory transfer buffer");
  }
  let registerTransfer: UnicornRegisters;
  try {
    registerTransfer = new UnicornRegisters(uc, handle);
  } catch (error) {
    uc._free(transfer);
    engine.close();
    throw error;
  }
  const translation = setup.translation
    ? translated(loaded, handle, registerTransfer, setup)
    : undefined;
  let blocks: UnicornBudget | undefined;
  try {
    blocks = setup.budget === ExecutionBudget.Blocks ? new UnicornBudget(uc, handle) : undefined;
  } catch (error) {
    registerTransfer.close();
    uc._free(transfer);
    compiler?.close();
    engine.close();
    throw error;
  }
  const states = new UnicornContexts<number>({
    allocate: () => engine.context_alloc(),
    save: (context) => engine.context_save(context),
    restore: (context) => engine.context_restore(context),
    free: (context) => engine.context_free(context),
  });
  const registers = loaded.core;
  return {
    uc,
    engine,
    handle,
    transfer,
    registerTransfer,
    registers,
    compiler,
    translation,
    blocks,
    states,
  };
}
