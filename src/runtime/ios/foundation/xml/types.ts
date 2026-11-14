export const XML_ERROR_DOMAIN = "NSXMLParserErrorDomain";
export const XML_PARSER_CLASS = "NSXMLParser";
export const XMLLimit = { Bytes: 16_777_216, Depth: 256, Nodes: 262_144 } as const;
export const XMLError = {
  Internal: 1,
  Empty: 4,
  Encoding: 81,
  Unbalanced: 85,
  MismatchedTag: 76,
  Aborted: 512,
} as const;
export class XMLParseFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
export interface XMLName {
  name: string;
  namespace: string | null;
  qualified: string | null;
}
export type XMLEvent =
  | { kind: "start"; element: XMLName; attributes: Readonly<Record<string, string>> }
  | { kind: "end"; element: XMLName }
  | { kind: "text" | "comment" | "cdata"; value: string }
  | { kind: "instruction"; target: string; data: string | null }
  | { kind: "namespaceStart"; prefix: string; uri: string }
  | { kind: "namespaceEnd"; prefix: string };
export interface XMLSettings {
  namespaces: boolean;
  prefixes: boolean;
  externalEntities: boolean;
}
export interface XMLRecord extends XMLSettings {
  bytes: Uint8Array;
  delegate: number;
  error: number;
  phase: "ready" | "parsing" | "finished";
  aborted: boolean;
}
