import type { FoundationHost } from "../../objc/host";

interface RemoteNotificationHost extends Pick<FoundationHost, "method"> {
  send(receiver: number, selector: string, args?: number[]): Promise<unknown>;
  responds(receiver: number, selector: string): boolean;
  delegate(): number;
  error(code: number, domain: string): number;
  later(task: () => Promise<void>): void;
}
const APPLICATION_CLASS = "UIApplication";
const FAILED = "application:didFailToRegisterForRemoteNotificationsWithError:";
/** NSCocoaErrorDomain code iOS reports when the app has no aps-environment entitlement. */
const MISSING_ENTITLEMENT = 3000;
const COCOA_ERROR_DOMAIN = "NSCocoaErrorDomain";

/** Apple's push service cannot reach a browser, so registration fails as it does for unentitled apps. */
export function installRemoteNotifications(host: RemoteNotificationHost): void {
  host.method(APPLICATION_CLASS, false, "registerForRemoteNotificationTypes:", (self) => {
    host.later(async () => {
      const delegate = host.delegate();
      if (delegate && host.responds(delegate, FAILED))
        await host.send(delegate, FAILED, [
          self,
          host.error(MISSING_ENTITLEMENT, COCOA_ERROR_DOMAIN),
        ]);
    });
  });
  host.method(APPLICATION_CLASS, false, "unregisterForRemoteNotifications", () => undefined);
  host.method(APPLICATION_CLASS, false, "enabledRemoteNotificationTypes", () => 0);
}
