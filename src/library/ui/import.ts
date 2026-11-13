import type { ApplicationLibrary } from "../service";
import { ImportPhase } from "../contracts";
import { element } from "../../ui/dom";
import { libraryJournal } from "../../diagnostics/journal";
import { DiagnosticOperation } from "../../diagnostics/operations";
const messages = {
  [ImportPhase.Inspecting]: "Reading app information",
  [ImportPhase.Storing]: "Keeping this app on your device",
  [ImportPhase.Committing]: "Adding to your library",
  [ImportPhase.Complete]: "Added to your library",
};

export function connectImport(
  library: ApplicationLibrary,
  refresh: () => Promise<void>,
  failure: (error: unknown) => void,
): void {
  const inputs = [element("import", HTMLInputElement), element("empty-import", HTMLInputElement)];
  const status = element("import-status", HTMLDivElement);
  const message = status.querySelector("span");
  const indicator = status.querySelector("progress");
  if (!message || !indicator) throw new Error("Missing import progress interface.");
  let importing = false;
  const add = async (file: File): Promise<void> => {
    if (importing) return;
    importing = true;
    status.hidden = false;
    for (const input of inputs) input.disabled = true;
    element("error", HTMLParagraphElement).hidden = true;
    element("error-logs", HTMLButtonElement).hidden = true;
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
        indicator.value = progress.totalBytes ? progress.completedBytes / progress.totalBytes : 0;
      });
      await refresh();
    } catch (error) {
      libraryJournal.record(
        DiagnosticOperation.Import,
        { state: "failed", phase, completedBytes, totalBytes: file.size },
        error,
      );
      throw error;
    } finally {
      importing = false;
      status.hidden = true;
      for (const input of inputs) {
        input.disabled = false;
        input.value = "";
      }
    }
  };
  for (const input of inputs)
    input.addEventListener("change", () => {
      const file = input.files?.item(0);
      if (file) void add(file).catch(failure);
    });
}
