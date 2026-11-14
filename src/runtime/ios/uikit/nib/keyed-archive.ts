import {
  ARCHIVE_VERSION,
  ArchiveReference,
  type ArchiveFields,
} from "../../foundation/archives/graph";
import type { NibArchive, NibObject } from "./archive";
const TEXT = new TextDecoder("utf-8", { fatal: true });
export const NibKey = {
  Objects: "UINibObjectsKey",
  TopLevel: "UINibTopLevelObjectsKey",
  Connections: "UINibConnectionsKey",
  VisibleWindows: "UINibVisibleWindowsKey",
  CustomObject: "RetroveNibCustomObject",
} as const;
function fields(object: NibObject): ArchiveFields {
  return Object.fromEntries(
    object.values.map(([key, value]) => [
      key,
      value instanceof ArchiveReference ? new ArchiveReference(value.index + 1) : value,
    ]),
  );
}
function string(archive: NibArchive, reference: unknown): string {
  if (!(reference instanceof ArchiveReference)) throw new Error("Missing nib class name.");
  const object = archive.objects[reference.index];
  const value = object?.values.find(([key]) => key === "NS.bytes")?.[1];
  if (object?.className !== "NSString" || !(value instanceof Uint8Array))
    throw new Error("Invalid nib class name.");
  return TEXT.decode(value);
}
export function keyedNib(archive: NibArchive): ArchiveFields {
  const objects: unknown[] = ["$null"],
    classes = new Map<string, ArchiveReference>();
  const converted = archive.objects.map((object) => {
    let name = object.className;
    const value = fields(object);
    if (name === "UIClassSwapper") {
      const raw = Object.fromEntries(object.values);
      name = string(archive, raw.UIClassName);
      if (string(archive, raw.UIOriginalClassName) === "UICustomObject")
        value[NibKey.CustomObject] = true;
    }
    if (name === "NSString" || name === "NSMutableString") {
      const bytes = value["NS.bytes"];
      if (!(bytes instanceof Uint8Array)) throw new Error("Invalid nib string.");
      value["NS.string"] = TEXT.decode(bytes);
    }
    if (
      name === "NSArray" ||
      name === "NSMutableArray" ||
      name === "NSSet" ||
      name === "NSMutableSet"
    )
      value["NS.objects"] = object.values
        .filter(([key]) => key === "UINibEncoderEmptyKey")
        .map(([, value]) =>
          value instanceof ArchiveReference ? new ArchiveReference(value.index + 1) : value,
        );
    return { name, value };
  });
  for (const { value } of converted) objects.push(value);
  for (const { value } of converted)
    for (const [key, item] of Object.entries(value)) {
      if (item instanceof Uint8Array) {
        value[key] = new ArchiveReference(objects.length);
        objects.push(item);
      } else if (item === null) value[key] = new ArchiveReference(0);
    }

  for (const { name, value } of converted) {
    let reference = classes.get(name);
    if (!reference) {
      reference = new ArchiveReference(objects.length);
      classes.set(name, reference);
      objects.push({ $classname: name, $classes: [name] });
    }
    value.$class = reference;
  }
  const root = archive.objects[0];
  if (!root) throw new Error("Empty nib archive.");
  return {
    $archiver: "NSKeyedArchiver",
    $version: ARCHIVE_VERSION,
    $objects: objects,
    $top: fields(root),
  };
}
