import { ApplicationLibrary } from "./service";
import { BrowserArchives } from "../storage/archive-repository";
import { LibraryDatabase } from "../storage/library-database";
import { browserLibraryEnvironment } from "../storage/environment";

import { collectOrphanArchives } from "../storage/archive-maintenance";
interface BrowserLibrary {
  readonly library: ApplicationLibrary;
  readonly recover: () => Promise<number>;
}
export function browserLibrary(report: (error: unknown) => void): BrowserLibrary {
  const database = new LibraryDatabase();
  const inspector = {
    async inspect(file: File, signal: AbortSignal) {
      const { inspectIpa } = await import("../runtime/ios/package/inspector");
      return inspectIpa(file, signal, report);
    },
  };
  const archives = new BrowserArchives(database);
  const library = new ApplicationLibrary(
    database,
    archives,
    inspector,
    browserLibraryEnvironment(report),
  );
  return { library, recover: () => collectOrphanArchives(database, archives) };
}
