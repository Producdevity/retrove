import { dispatchXML } from "./dispatch";
import type { XMLBackend, XMLHost } from "./host";
import { XMLError, XML_ERROR_DOMAIN, XMLParseFailure, type XMLRecord } from "./types";
export function newXMLRecord(): XMLRecord {
  return {
    bytes: new Uint8Array(),
    delegate: 0,
    error: 0,
    phase: "ready",
    aborted: false,
    namespaces: false,
    prefixes: false,
    externalEntities: false,
  };
}
async function recordError(
  host: XMLHost,
  parser: number,
  record: XMLRecord,
  error: XMLParseFailure,
): Promise<void> {
  const previous = record.error;
  record.error = host.retain(host.error(error.code, XML_ERROR_DOMAIN));
  if (previous) await host.release(previous);
  host.diagnostic(error.message, error.code);
  await host.send(record.delegate, "parser:parseErrorOccurred:", [parser, record.error], true);
}
export async function parseXML(
  host: XMLHost,
  backend: XMLBackend,
  parser: number,
  record: XMLRecord,
): Promise<number> {
  if (record.phase === "parsing") throw new Error("NSXMLParser is already parsing.");
  if (record.phase === "finished")
    throw new Error("NSXMLParser cannot parse the same input twice.");
  record.phase = "parsing";
  record.aborted = false;
  host.retain(parser);
  const checkpoint = () => {
    if (record.aborted)
      throw new XMLParseFailure(XMLError.Aborted, "XML parsing was aborted by its delegate.");
  };
  try {
    await host.send(record.delegate, "parserDidStartDocument:", [parser], true);
    checkpoint();
    for (const event of backend(record.bytes, record)) {
      checkpoint();
      await dispatchXML(host, record.delegate, parser, event);
      checkpoint();
    }
    await host.send(record.delegate, "parserDidEndDocument:", [parser], true);
    checkpoint();
    return 1;
  } catch (error) {
    if (!(error instanceof XMLParseFailure)) throw error;
    await recordError(host, parser, record, error);
    return 0;
  } finally {
    record.phase = "finished";
    record.bytes = new Uint8Array();
    await host.release(parser);
  }
}
