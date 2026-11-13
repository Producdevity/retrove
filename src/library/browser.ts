import { ApplicationLibrary } from "./service";
import { BrowserArchives } from "../storage/archive-repository";
import { LibraryDatabase } from "../storage/library-database";
import { browserLibraryEnvironment } from "../storage/environment";

export function browserLibrary(report: (error: unknown) => void): ApplicationLibrary {
  const database = new LibraryDatabase();
  const inspector = {
    async inspect(file: File, signal: AbortSignal) {
      const { inspectIpa } = await import("../runtime/ios/package/inspector");
      return inspectIpa(file, signal, report);
    },
  };
  return new ApplicationLibrary(
    database,
    new BrowserArchives(database),
    inspector,
    browserLibraryEnvironment(report),
  );
}
