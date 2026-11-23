export const HEX_RADIX = 16;
export const DECIMAL_RADIX = 10;
export const MILLISECONDS_PER_SECOND = 1000;
export const MAIN_THREAD_ID = 1;
export const DataField = { Bytes: 4, Length: 8 } as const;
export const NotificationField = { Name: 4, Sender: 8, UserInfo: 12 } as const;
export const NOTIFICATION_BYTES = 16;
export const ErrorDomain = { Cocoa: "NSCocoaErrorDomain", URL: "NSURLErrorDomain" } as const;
export const JSON_READ_CORRUPT_ERROR = 3840;
export const JSON_PRETTY_PRINTED = 1;
export const JSON_INDENT = 2;
export const UrlError = { Offline: -1009, MissingFile: -1100 } as const;
export const NAVIGATION_TYPE_OTHER = 5;
export const PHYSICAL_MEMORY_BYTES = 0x4000_0000n;
export const PROCESSOR_COUNT = 1;
export const NOT_FOUND = 0x7fff_ffff;
export const DEFAULT_LANGUAGE = "en-US";
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";
export const DeviceOrientation = {
  Unknown: 0,
  PortraitPrimary: 1,
  PortraitSecondary: 2,
  LandscapePrimary: 3,
  LandscapeSecondary: 4,
} as const;
export const OrientationName: Record<string, number> = {
  "portrait-primary": DeviceOrientation.PortraitPrimary,
  "portrait-secondary": DeviceOrientation.PortraitSecondary,
  "landscape-primary": DeviceOrientation.LandscapePrimary,
  "landscape-secondary": DeviceOrientation.LandscapeSecondary,
};
export const StringCompare = {
  CaseInsensitive: 1,
  Backwards: 4,
  Anchored: 8,
  Numeric: 64,
  DiacriticInsensitive: 128,
} as const;
export const StringEncoding = {
  ASCII: 1,
  UTF8: 4,
  Latin1: 5,
  UTF16: 10,
  UTF16BigEndian: 0x9000_0100,
  UTF16LittleEndian: 0x9400_0100,
} as const;
export const UTF16_FAMILY_START = 0x9000_0000;
export const MAX_BYTE = 255;
export const UTF16_UNIT_BYTES = 2;
export const SortDirection = { Descending: 0 } as const;
export const HttpStatusText: Record<number, string> = {
  200: "no error",
  201: "created",
  204: "no content",
  301: "moved permanently",
  302: "found",
  304: "not modified",
  400: "bad request",
  401: "unauthorized",
  403: "forbidden",
  404: "not found",
  500: "internal server error",
  503: "service unavailable",
};
export const DEFAULT_HTTP_STATUS = 200;
export const SECONDS_PER_MILLISECOND_DIVISOR = 1000;
export const SUPPORTED_REQUEST_PROTOCOLS = ["https:", "http:", "file:"];
export const MAX_EXPRESSION_PREVIEW = 96;
export const BYTES_PER_WORD = 4;
export const PAIR_STEP = 2;
export const MERGE_FACTOR = 2;
export const ASCII_MAX = 0x7f;
export const FLOAT_BITS = 0;
export const BOOLEAN_TEXT = /^[yYtT1-9]/;
export const BLOCK_INVOKE_OFFSET = 12;
export const UNKNOWN_CONTENT_LENGTH = -1;
export const NOTIFICATION_FIELDS = [
  NotificationField.Name,
  NotificationField.Sender,
  NotificationField.UserInfo,
] as const;
