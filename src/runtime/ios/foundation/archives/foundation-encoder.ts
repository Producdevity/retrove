import type { ArchiveEncoder } from "./encoder";
import type { ArchiveFields } from "./graph";

interface FoundationEncodingHost {
  text(pointer: number): string;
  data(pointer: number): Uint8Array;
  date(pointer: number): number;
  entries(pointer: number): [number, number][];
  items(pointer: number): number[];
}
export function encodeFoundation(host: FoundationEncodingHost) {
  return async (pointer: number, name: string, fields: ArchiveFields, graph: ArchiveEncoder) => {
    switch (name) {
      case "NSDictionary":
      case "NSMutableDictionary": {
        const keys = [],
          values = [];
        for (const [key, value] of host.entries(pointer)) {
          keys.push(await graph.encode(key));
          values.push(await graph.encode(value));
        }
        fields["NS.keys"] = keys;
        fields["NS.objects"] = values;
        break;
      }
      case "NSArray":
      case "NSMutableArray":
      case "NSSet":
      case "NSMutableSet": {
        const values = [];
        for (const value of host.items(pointer)) values.push(await graph.encode(value));
        fields["NS.objects"] = values;
        break;
      }
      case "NSMutableString":
        fields["NS.string"] = host.text(pointer);
        break;
      case "NSData":
      case "NSMutableData":
        fields["NS.data"] = host.data(pointer);
        break;
      case "NSDate":
        fields["NS.time"] = host.date(pointer);
        break;
      case "NSNull":
        break;
      default:
        return false;
    }
    return true;
  };
}
