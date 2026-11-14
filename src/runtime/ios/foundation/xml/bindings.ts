import { xmlEvents } from "./dom";
import type { XMLBackend, XMLHost } from "./host";
import { newXMLRecord, parseXML } from "./session";
import { XMLError, XMLLimit, XML_PARSER_CLASS, XMLParseFailure, type XMLRecord } from "./types";
export function installXMLParser(host: XMLHost, backend: XMLBackend = xmlEvents): void {
  host.hostClass(XML_PARSER_CLASS, "NSObject");
  const records = new Map<number, XMLRecord>();
  const state = (pointer: number): XMLRecord => {
    let value = records.get(pointer);
    if (!value) {
      value = newXMLRecord();
      records.set(pointer, value);
    }
    return value;
  };
  host.method(XML_PARSER_CLASS, false, "initWithData:", async (self, args) => {
    const data = args(0);
    if (!data) {
      const old = records.get(self);
      records.delete(self);
      if (old?.error) await host.release(old.error);
      host.destroy(self);
      return 0;
    }
    const length = host.dataLength(data);
    if (length > XMLLimit.Bytes)
      throw new XMLParseFailure(XMLError.Internal, "XML input exceeds the byte limit.");
    const bytes = host.readData(data, length).slice(),
      old = records.get(self);
    records.set(self, { ...newXMLRecord(), bytes });
    if (old?.error) await host.release(old.error);
    return self;
  });
  host.method(XML_PARSER_CLASS, false, "setDelegate:", (self, args) => {
    state(self).delegate = args(0);
  });
  host.method(XML_PARSER_CLASS, false, "delegate", (self) => state(self).delegate);
  host.method(XML_PARSER_CLASS, false, "parserError", (self) => state(self).error);
  host.method(XML_PARSER_CLASS, false, "abortParsing", (self) => {
    if (state(self).phase === "parsing") state(self).aborted = true;
  });
  host.method(XML_PARSER_CLASS, false, "parse", (self) =>
    parseXML(host, backend, self, state(self)),
  );
  for (const [getter, setter, field] of [
    ["shouldProcessNamespaces", "setShouldProcessNamespaces:", "namespaces"],
    ["shouldReportNamespacePrefixes", "setShouldReportNamespacePrefixes:", "prefixes"],
    ["shouldResolveExternalEntities", "setShouldResolveExternalEntities:", "externalEntities"],
  ] as const) {
    host.method(XML_PARSER_CLASS, false, getter, (self) => Number(state(self)[field]));
    host.method(XML_PARSER_CLASS, false, setter, (self, args) => {
      state(self)[field] = Boolean(args(0));
    });
  }
  host.method(XML_PARSER_CLASS, false, "dealloc", async (self) => {
    const record = records.get(self);
    records.delete(self);
    if (record?.error) await host.release(record.error);
    host.destroy(self);
  });
}
