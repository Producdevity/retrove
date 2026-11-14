import { Argument, type FoundationHost, type HostResult } from "../objc/host";
import { pathWithComponents } from "./paths";
export const BundleKey = {
  InfoDictionaryVersion: "CFBundleInfoDictionaryVersion",
  Executable: "CFBundleExecutable",
  Identifier: "CFBundleIdentifier",
  Version: "CFBundleVersion",
  DevelopmentRegion: "CFBundleDevelopmentRegion",
  Name: "CFBundleName",
  Localizations: "CFBundleLocalizations",
} as const;

interface BundleResourceHost extends Pick<FoundationHost, "method" | "text" | "string"> {
  send(pointer: number, selector: string, args: number[]): Promise<HostResult>;
}
export function installBundleDirectories(host: BundleResourceHost): void {
  host.method("NSBundle", false, "pathForResource:ofType:inDirectory:", (self, args) => {
    const name = args(0),
      extension = args(1),
      directory = args(Argument.Third);
    if (!name) return 0;
    const folder = directory ? host.text(directory) : "";
    const resource = folder ? host.string(pathWithComponents([folder, host.text(name)])) : name;
    return host.send(self, "pathForResource:ofType:", [resource, extension]);
  });
}
