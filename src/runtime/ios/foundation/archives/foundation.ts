import { type ArchiveGraph, archiveArray, type ArchiveFields } from "./graph";

interface ArchiveFoundation {
  string(pointer: number, value: string): void;
  number(pointer: number, value: number | boolean | bigint): void;
  date(pointer: number, referenceTime: number): void;
  data(pointer: number, bytes: Uint8Array): void;
  dictionary(pointer: number, key: number, value: number): Promise<void>;
  collection(pointer: number, values: number[]): void;
}
export function archiveFoundation(host: ArchiveFoundation) {
  return async (
    pointer: number,
    name: string,
    fields: ArchiveFields,
    graph: ArchiveGraph,
  ): Promise<number | undefined> => {
    switch (name) {
      case "NSDictionary":
      case "NSMutableDictionary": {
        const keys = archiveArray(fields["NS.keys"]);
        const values = archiveArray(fields["NS.objects"]);
        if (keys.length !== values.length) throw Error("Invalid archived dictionary entries");
        for (let index = 0; index < keys.length; index++) {
          await host.dictionary(
            pointer,
            await graph.decode(keys[index]),
            await graph.decode(values[index]),
          );
        }
        break;
      }
      case "NSArray":
      case "NSMutableArray":
      case "NSSet":
      case "NSMutableSet": {
        const values: number[] = [];
        for (const reference of archiveArray(fields["NS.objects"]))
          values.push(await graph.decode(reference));
        host.collection(pointer, values);
        break;
      }
      case "NSString":
      case "NSMutableString": {
        const value = fields["NS.string"];
        if (typeof value !== "string") throw Error("Invalid archived string");
        host.string(pointer, value);
        break;
      }
      case "NSData":
      case "NSMutableData": {
        const value = fields["NS.data"];
        if (!(value instanceof Uint8Array)) throw Error("Invalid archived data");
        host.data(pointer, value);
        break;
      }
      case "NSDate": {
        const value = fields["NS.time"];
        if (typeof value !== "number" || !Number.isFinite(value))
          throw Error("Invalid archived date");
        host.date(pointer, value);
        break;
      }
      case "NSNumber": {
        const value =
          fields["NS.boolval"] ??
          fields["NS.intval"] ??
          fields["NS.dblval"] ??
          fields["NS.floatval"];
        if (typeof value !== "number" && typeof value !== "boolean" && typeof value !== "bigint")
          throw Error("Invalid archived number");
        host.number(pointer, value);
        break;
      }
      case "NSNull":
        break;
      default:
        return undefined;
    }
    return pointer;
  };
}
