import { ColorSymbols } from "../../graphics/core-graphics/colors/bindings";
import { CFNetworkStrings } from "../cfnetwork/bindings";
import { BundleKey } from "../foundation/bundle";
import { FoundationErrorSymbol } from "../foundation/errors";
import { ExceptionSymbols } from "../foundation/exceptions";
import { LocaleSymbols } from "../foundation/locale-components";
import { XML_ERROR_DOMAIN } from "../foundation/xml/types";
import { MovieNotification, MovieUserInfo } from "../media/movie-playback";
import { MusicPlayerSymbols } from "../media/music-player";
import { SecuritySymbols } from "../security/constants";
import { LocationSymbols } from "../services/core-location";
import { AdSymbols } from "../services/iad";
import { UniformTypeSymbols } from "../services/uniform-types";
import { AnimationSymbols } from "../uikit/animation/basic";
import { TransitionSymbols } from "../uikit/animation/transitions";
import { LayerGravitySymbols } from "../uikit/image/content-gravity";

/** Exported NSString constants whose value is their own name. */
const SELF_NAMED = [
  "UIApplicationWillResignActiveNotification",
  "UIApplicationDidBecomeActiveNotification",
  "UIApplicationDidEnterBackgroundNotification",
  "UIApplicationDidReceiveMemoryWarningNotification",
  "UIApplicationWillEnterForegroundNotification",
  "UIApplicationLaunchOptionsLocalNotificationKey",
  "UIApplicationWillTerminateNotification",
  "UIDeviceOrientationDidChangeNotification",
  "UIKeyboardWillHideNotification",
  "UIKeyboardWillShowNotification",
  "UIKeyboardFrameEndUserInfoKey",
  "UIScreenDidConnectNotification",
  "UIScreenDidDisconnectNotification",
  "NSPOSIXErrorDomain",
  "NSCocoaErrorDomain",
  "NSFilePosixPermissions",
] as const;
const RENAMED = [
  ["kEAGLColorFormatRGB565", "RGB565"],
  ["kEAGLColorFormatRGBA8", "RGBA8"],
  ["kEAGLDrawablePropertyColorFormat", "EAGLDrawablePropertyColorFormat"],
  ["kEAGLDrawablePropertyRetainedBacking", "EAGLDrawablePropertyRetainedBacking"],
  ["AVAudioSessionInterruptionTypeKey", "AVAudioSessionInterruptionTypeKey"],
  ["AVAudioSessionRouteChangeReasonKey", "AVAudioSessionRouteChangeReasonKey"],
] as const;
const GAME_SERVICES = [
  "GCControllerDidConnectNotification",
  "GCControllerDidDisconnectNotification",
  "GKPlayerAuthenticationDidChangeNotificationName",
  "GKPlayerDidChangeNotificationName",
  "GKErrorDomain",
] as const;
const FILES_AND_METADATA = [
  "NSFileModificationDate",
  "NSFileCreationDate",
  "NSFileSystemFreeSize",
  "NSFileSystemSize",
  "NSMetadataItemFSContentChangeDateKey",
  "NSMetadataItemFSNameKey",
  "NSMetadataItemURLKey",
  "NSMetadataQueryDidFinishGatheringNotification",
  "NSMetadataQueryDidUpdateNotification",
  "NSMetadataQueryUbiquitousDocumentsScope",
  "NSMetadataUbiquitousItemDownloadingStatusKey",
  "NSMetadataUbiquitousItemHasUnresolvedConflictsKey",
  "NSMetadataUbiquitousItemIsDownloadingKey",
  "NSMetadataUbiquitousItemIsUploadedKey",
  "NSMetadataUbiquitousItemIsUploadingKey",
  "NSMetadataUbiquitousItemPercentDownloadedKey",
  "NSMetadataUbiquitousItemPercentUploadedKey",
  "NSURLIsExcludedFromBackupKey",
  "NSURLIsUbiquitousItemKey",
  "NSURLUbiquitousItemDownloadingStatusCurrent",
  "NSURLUbiquitousItemDownloadingStatusKey",
  "NSURLUbiquitousItemHasUnresolvedConflictsKey",
] as const;
const ATTRIBUTES = [
  ["NSFontAttributeName", "NSFont"],
  ["NSForegroundColorAttributeName", "NSColor"],
  ["NSGregorianCalendar", "gregorian"],
] as const;
const symbol = (name: string) => `_${name}`;
/** Exported NSString symbols and the text each one holds, in the order later entries override. */
export function exportedStringNames(): Map<string, string> {
  const names = new Map<string, string>([
    ...Object.entries(FoundationErrorSymbol),
    ["_NSDefaultRunLoopMode", "kCFRunLoopDefaultMode"],
    ["_kCFRunLoopDefaultMode", "kCFRunLoopDefaultMode"],
    ["_NSRunLoopCommonModes", "kCFRunLoopCommonModes"],
    ["_kCFRunLoopCommonModes", "kCFRunLoopCommonModes"],
    ["_NSFilePathErrorKey", "NSFilePath"],
    ["_NSUnderlyingErrorKey", "NSUnderlyingError"],
    ["_NSLocalizedDescriptionKey", "NSLocalizedDescription"],
  ]);
  const add = (entries: Record<string, string>) => {
    for (const [name, value] of Object.entries(entries)) names.set(name, value);
  };
  add(ColorSymbols);
  add(LayerGravitySymbols);
  add({ ...AnimationSymbols, ...TransitionSymbols, ...MusicPlayerSymbols });
  names.set("_NSXMLParserErrorDomain", XML_ERROR_DOMAIN);
  add({ ...ExceptionSymbols, ...AdSymbols, ...LocationSymbols, ...UniformTypeSymbols });
  add(SecuritySymbols);
  add(LocaleSymbols);
  add(CFNetworkStrings);
  for (const [name, value] of Object.entries(BundleKey)) names.set(`_kCFBundle${name}Key`, value);
  for (const name of SELF_NAMED) names.set(symbol(name), name);
  for (const [name, value] of RENAMED) names.set(symbol(name), value);
  for (const name of GAME_SERVICES) names.set(symbol(name), name);
  for (const name of FILES_AND_METADATA) names.set(symbol(name), name);
  for (const [name, value] of ATTRIBUTES) names.set(symbol(name), value);
  for (const name of [
    ...Object.values(MovieNotification),
    ...Object.values(MovieUserInfo),
    "AVAudioSessionInterruptionTypeKey",
    "AVAudioSessionRouteChangeReasonKey",
  ])
    names.set(symbol(name), name);
  return names;
}
