import type { ServiceHost } from "./host";

/** MessageUI on a device with no mail account and no messaging: apps check and hide the option. */
export function installMessageComposers(host: ServiceHost): void {
  for (const [name, check] of [
    ["MFMailComposeViewController", "canSendMail"],
    ["MFMessageComposeViewController", "canSendText"],
  ] as const) {
    host.hostClass(name, "UIViewController");
    host.method(name, true, check, () => 0);
  }
  host.method("MFMessageComposeViewController", true, "canSendAttachments", () => 0);
  host.method("MFMessageComposeViewController", true, "canSendSubject", () => 0);
}
