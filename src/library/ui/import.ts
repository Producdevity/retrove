import type { ApplicationLibrary } from "../service";
import { ImportPhase } from "../contracts";
import { element } from "../../ui/dom";
import { libraryJournal } from "../../diagnostics/journal";
import { DiagnosticOperation } from "../../diagnostics/operations";
import { morph } from "../../ui/morph";
const messages = {
  [ImportPhase.Inspecting]: "Reading the IPA",
  [ImportPhase.Storing]: "Saving",
  [ImportPhase.Committing]: "Adding to library",
  [ImportPhase.Complete]: "Added",
};
const IPA_EXTENSION = /\.ipa$/iu;
const COMPACT = "(max-width: 699px)";
const PRECISION = 3;

export function connectImport(
  library: ApplicationLibrary,
  refresh: () => Promise<void>,
  failure: (error: unknown) => void,
  animating: (milliseconds: number) => void,
): void {
  const inputs = [element("import", HTMLInputElement), element("empty-import", HTMLInputElement)];
  const add = inputs[0]?.closest("label");
  const status = element("import-status", HTMLDivElement);
  const title = element("import-title", HTMLElement);
  const message = status.querySelector(".importer-text span");
  const indicator = status.querySelector("progress");
  if (!message || !indicator || !add) throw new Error("Missing import progress interface.");
  const show = (visible: boolean): Promise<void> => {
    const compact = matchMedia(COMPACT).matches;
    if (visible) status.hidden = false;
    add.classList.toggle("morphed", visible && compact);
    const done = compact ? morph(status, add, visible, animating) : Promise.resolve();
    return done.then(() => {
      if (!visible) status.hidden = true;
    });
  };
  let importing = false;
  const run = async (file: File): Promise<void> => {
    let phase: ImportPhase = ImportPhase.Inspecting;
    let completedBytes = 0;
    libraryJournal.record(DiagnosticOperation.Import, { state: "started", bytes: file.size });
    try {
      await library.import(file, new AbortController().signal, (progress) => {
        if (phase !== progress.phase)
          libraryJournal.record(DiagnosticOperation.ImportProgress, {
            phase: progress.phase,
            bytes: progress.completedBytes,
          });
        phase = progress.phase;
        completedBytes = progress.completedBytes;
        message.textContent = messages[progress.phase];
        const fraction = progress.totalBytes ? progress.completedBytes / progress.totalBytes : 0;
        indicator.value = fraction;
        status.style.setProperty("--progress", fraction.toFixed(PRECISION));
      });
      await refresh();
    } catch (error) {
      libraryJournal.record(
        DiagnosticOperation.Import,
        { state: "failed", phase, completedBytes, totalBytes: file.size },
        error,
      );
      throw error;
    }
  };
  const start = async (file: File): Promise<void> => {
    if (importing) return;
    importing = true;
    title.textContent = `Adding ${file.name.replace(IPA_EXTENSION, "")}`;
    message.textContent = messages[ImportPhase.Inspecting];
    status.style.setProperty("--progress", "0");
    for (const input of inputs) input.disabled = true;
    element("error", HTMLParagraphElement).hidden = true;
    element("error-logs", HTMLButtonElement).hidden = true;
    await show(true);
    try {
      await run(file);
    } finally {
      importing = false;
      for (const input of inputs) {
        input.disabled = false;
        input.value = "";
      }
      await show(false);
    }
  };
  for (const input of inputs)
    input.addEventListener("change", () => {
      const file = input.files?.item(0);
      if (file) void start(file).catch(failure);
    });
}
