import { GuestStorageKey } from "../../../../storage/guest-keys";
import type { FoundationParams } from "./types";

export function bundleIdentifier(ipa: FoundationParams["ipa"]): string {
  const identifier = ipa.info.CFBundleIdentifier;
  return typeof identifier === "string" ? identifier : ipa.bundlePath;
}
export function preferenceDomain(ipa: FoundationParams["ipa"]): string {
  return GuestStorageKey.Preferences + bundleIdentifier(ipa);
}
export function vendorIdentifierKey(ipa: FoundationParams["ipa"]): string {
  return preferenceDomain(ipa) + GuestStorageKey.VendorSuffix;
}
