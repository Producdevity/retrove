import { delegateAccessors, failLater, type ServiceHost } from "./host";

const DOMAIN = "ADErrorDomain";
/** ADErrorInventoryUnavailable: no ad is ever served. */
const AD_ERROR_INVENTORY_UNAVAILABLE = 3;
const CLASS = "ADBannerView";
/** Exported ADBannerContentSizeIdentifier strings. */
export const AdSymbols: Readonly<Record<string, string>> = Object.fromEntries(
  ["320x50", "480x32", "Portrait", "Landscape"].map((size) => [
    `_ADBannerContentSizeIdentifier${size}`,
    `ADBannerContentSizeIdentifier${size}`,
  ]),
);

/** iAd banners that never load, so apps keep them hidden. */
export function installAdBanners(host: ServiceHost): void {
  host.hostClass(CLASS, "UIView");
  const delegates = new Map<number, number>();
  delegateAccessors(host, CLASS, delegates);
  const fail = (self: number) =>
    failLater(
      host,
      () => delegates.get(self) ?? 0,
      "bannerView:didFailToReceiveAdWithError:",
      [self],
      () => host.error(AD_ERROR_INVENTORY_UNAVAILABLE, DOMAIN),
    );
  for (const name of [
    "bannerLoaded",
    "isBannerViewActionInProgress",
    "requiredContentSizeIdentifiers",
    "currentContentSizeIdentifier",
  ])
    host.method(CLASS, false, name, () => 0);
  for (const name of [
    "setRequiredContentSizeIdentifiers:",
    "setCurrentContentSizeIdentifier:",
    "cancelBannerViewAction",
  ])
    host.method(CLASS, false, name, () => undefined);
  host.method(CLASS, false, "setDelegate:", (self, args) => {
    if (args(0)) {
      delegates.set(self, args(0));
      fail(self);
    } else delegates.delete(self);
  });
}
