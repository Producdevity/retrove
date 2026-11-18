/** UTType tag classes as exported by MobileCoreServices. */
export const TagClass = {
  FilenameExtension: "public.filename-extension",
  MIMEType: "public.mime-type",
} as const;
export const UniformTypeSymbols: Readonly<Record<string, string>> = {
  _kUTTagClassFilenameExtension: TagClass.FilenameExtension,
  _kUTTagClassMIMEType: TagClass.MIMEType,
};
const TYPES: readonly { uti: string; extensions: readonly string[]; mime: string }[] = [
  { uti: "public.png", extensions: ["png"], mime: "image/png" },
  { uti: "public.jpeg", extensions: ["jpg", "jpeg"], mime: "image/jpeg" },
  { uti: "com.compuserve.gif", extensions: ["gif"], mime: "image/gif" },
  { uti: "public.plain-text", extensions: ["txt"], mime: "text/plain" },
  { uti: "public.html", extensions: ["html", "htm"], mime: "text/html" },
  { uti: "public.json", extensions: ["json"], mime: "application/json" },
  { uti: "public.xml", extensions: ["xml"], mime: "application/xml" },
  { uti: "com.apple.property-list", extensions: ["plist"], mime: "application/x-plist" },
  { uti: "com.adobe.pdf", extensions: ["pdf"], mime: "application/pdf" },
  { uti: "public.zip-archive", extensions: ["zip"], mime: "application/zip" },
  { uti: "public.mp3", extensions: ["mp3"], mime: "audio/mpeg" },
  { uti: "public.mpeg-4-audio", extensions: ["m4a"], mime: "audio/mp4" },
  { uti: "com.microsoft.waveform-audio", extensions: ["wav"], mime: "audio/wav" },
  { uti: "com.apple.coreaudio-format", extensions: ["caf"], mime: "audio/x-caf" },
  { uti: "public.mpeg-4", extensions: ["mp4"], mime: "video/mp4" },
  { uti: "com.apple.quicktime-movie", extensions: ["mov"], mime: "video/quicktime" },
];

/** UTTypeCreatePreferredIdentifierForTag; unknown tags get a dynamic identifier as on iOS. */
export function identifierForTag(tagClass: string, tag: string): string {
  const key = tag.toLowerCase();
  const match = TYPES.find((type) =>
    tagClass === TagClass.MIMEType ? type.mime === key : type.extensions.includes(key),
  );
  return match?.uti ?? `dyn.${tagClass === TagClass.MIMEType ? "mime" : "ext"}.${key}`;
}
/** UTTypeCopyPreferredTagWithClass; undefined when the type has no tag of that class. */
export function preferredTag(uti: string, tagClass: string): string | undefined {
  const match = TYPES.find((type) => type.uti === uti);
  if (!match) return undefined;
  return tagClass === TagClass.MIMEType ? match.mime : match.extensions[0];
}
