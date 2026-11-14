import type { HostResult } from "../../objc/host";
import { objectResult } from "../host";
const APPLICATION_CLASS = "UIApplication";
const DIAGNOSTIC_CLASS_NAME_LIMIT = 192;
const LaunchPhase = {
  Application: "UIKit application launch",
  Delegate: "UIKit delegate launch callbacks",
} as const;
interface LaunchHost {
  resolveClass(name: string): number | undefined;
  isApplicationClass(pointer: number): boolean;
  currentApplication(): number;
  setApplication(pointer: number): void;
  responds(pointer: number, selector: string): boolean;
  send(pointer: number, selector: string, args?: number[], optional?: boolean): Promise<HostResult>;
  pushPool(): number;
  popPool(pointer: number): Promise<void>;
  connectInput(): void;
  activate(): Promise<void>;
  phase(name: string, details?: { delegate: string | null }): void;
}
async function instantiate(host: LaunchHost, klass: number): Promise<number> {
  return objectResult(await host.send(objectResult(await host.send(klass, "alloc")), "init"));
}
export async function launchApplication(
  host: LaunchHost,
  principalName: string | null,
  delegateName: string | null,
): Promise<void> {
  host.phase(LaunchPhase.Application, {
    delegate: delegateName?.slice(0, DIAGNOSTIC_CLASS_NAME_LIMIT) ?? null,
  });
  const klass = host.resolveClass(principalName ?? APPLICATION_CLASS);
  if (!klass || !host.isApplicationClass(klass))
    throw new Error("Unknown UIApplication principal class");
  if (host.currentApplication()) throw new Error("UIApplicationMain called twice");
  const pool = host.pushPool();
  try {
    const application = await instantiate(host, klass);
    host.setApplication(application);
    if (delegateName) {
      const delegate = host.resolveClass(delegateName);
      if (!delegate) throw new Error("Unknown UIApplication delegate " + delegateName);
      await host.send(application, "setDelegate:", [await instantiate(host, delegate)]);
    }
    const responder = objectResult(await host.send(application, "delegate"));
    if (responder) {
      host.phase(LaunchPhase.Delegate);
      await host.send(
        responder,
        "application:willFinishLaunchingWithOptions:",
        [application, 0],
        true,
      );
      if (host.responds(responder, "application:didFinishLaunchingWithOptions:"))
        await host.send(responder, "application:didFinishLaunchingWithOptions:", [application, 0]);
      else await host.send(responder, "applicationDidFinishLaunching:", [application], true);
    }
    host.connectInput();
    await host.activate();
  } finally {
    await host.popPool(pool);
  }
}
