import type { XMLHost } from "./host";
import type { XMLEvent } from "./types";
const encoder = new TextEncoder();
export async function dispatchXML(
  host: XMLHost,
  delegate: number,
  parser: number,
  event: XMLEvent,
): Promise<void> {
  const nullable = (value: string | null) => (value === null ? 0 : host.string(value));
  const elementArguments = (element: {
    name: string;
    namespace: string | null;
    qualified: string | null;
  }) => [host.string(element.name), nullable(element.namespace), nullable(element.qualified)];
  let selector: string, args: number[];
  switch (event.kind) {
    case "start":
      selector = "parser:didStartElement:namespaceURI:qualifiedName:attributes:";
      args = [...elementArguments(event.element), host.dictionary(event.attributes)];
      break;
    case "end":
      selector = "parser:didEndElement:namespaceURI:qualifiedName:";
      args = elementArguments(event.element);
      break;
    case "text":
      selector = "parser:foundCharacters:";
      args = [host.string(event.value)];
      break;
    case "comment":
      selector = "parser:foundComment:";
      args = [host.string(event.value)];
      break;
    case "cdata":
      selector = "parser:foundCDATA:";
      args = [host.data(encoder.encode(event.value))];
      break;
    case "instruction":
      selector = "parser:foundProcessingInstructionWithTarget:data:";
      args = [host.string(event.target), nullable(event.data)];
      break;
    case "namespaceStart":
      selector = "parser:didStartMappingPrefix:toURI:";
      args = [host.string(event.prefix), host.string(event.uri)];
      break;
    case "namespaceEnd":
      selector = "parser:didEndMappingPrefix:";
      args = [host.string(event.prefix)];
      break;
  }
  await host.send(delegate, selector, [parser, ...args], true);
}
