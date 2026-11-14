import { decodeXML } from "./decode";
import {
  XMLError,
  XMLLimit,
  XMLParseFailure,
  type XMLEvent,
  type XMLSettings,
  type XMLName,
} from "./types";
const NodeKind = { Element: 1, Text: 3, CDATA: 4, Instruction: 7, Comment: 8 } as const;
const Namespace = {
  XMLNS: "http://www.w3.org/2000/xmlns/",
  Error: "http://www.mozilla.org/newlayout/xml/parsererror.xml",
  HTML: "http://www.w3.org/1999/xhtml",
} as const;
interface Frame {
  node: Node;
  exit: boolean;
  depth: number;
}
function namespaceAttributes(element: Element): Attr[] {
  return Array.from(element.attributes).filter(
    (attribute) => attribute.namespaceURI === Namespace.XMLNS,
  );
}
function prefix(attribute: Attr): string {
  return attribute.name === "xmlns" ? "" : attribute.localName;
}
function name(element: Element, settings: XMLSettings): XMLName {
  return {
    name: settings.namespaces ? element.localName : element.tagName,
    namespace: settings.namespaces ? (element.namespaceURI ?? "") : null,
    qualified: settings.namespaces ? element.tagName : null,
  };
}
function attributes(element: Element, settings: XMLSettings): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => !settings.namespaces || attribute.namespaceURI !== Namespace.XMLNS)
      .map((attribute) => [attribute.name, attribute.value]),
  );
}
function documentFor(bytes: Uint8Array, settings: XMLSettings): Document {
  if (typeof DOMParser === "undefined")
    throw new Error("Native XML parsing is unavailable in this host.");
  const source = decodeXML(bytes),
    document = new DOMParser().parseFromString(source, "application/xml");
  for (const error of Array.from(document.getElementsByTagNameNS("*", "parsererror"))) {
    const message = error.textContent ?? "";
    if (
      error.namespaceURI === Namespace.Error ||
      (error.namespaceURI === Namespace.HTML &&
        message.includes("This page contains the following errors:"))
    )
      throw new XMLParseFailure(
        /tag mismatch|mismatched tag/i.test(message) ? XMLError.MismatchedTag : XMLError.Unbalanced,
        message,
      );
  }
  if (!document.documentElement)
    throw new XMLParseFailure(XMLError.Empty, "XML document has no root element.");
  if (settings.externalEntities && (document.doctype?.systemId || document.doctype?.publicId))
    throw new Error("External XML entity resolution is not implemented.");
  return document;
}
export function* xmlEvents(bytes: Uint8Array, settings: XMLSettings): Generator<XMLEvent> {
  const document = documentFor(bytes, settings),
    stack: Frame[] = Array.from(document.childNodes)
      .reverse()
      .map((node) => ({ node, exit: false, depth: 0 }));
  let count = 0;
  while (stack.length) {
    const frame = stack.pop();
    if (!frame) break;
    const { node, exit, depth } = frame;
    if (++count > XMLLimit.Nodes || depth > XMLLimit.Depth)
      throw new XMLParseFailure(XMLError.Internal, "XML document exceeds parser traversal limits.");
    if (node.nodeType === NodeKind.Element) {
      if (!(node instanceof Element)) throw new Error("Invalid XML element node.");
      const mappings = namespaceAttributes(node);
      if (exit) {
        yield { kind: "end", element: name(node, settings) };
        if (settings.prefixes)
          for (const attribute of mappings)
            yield { kind: "namespaceEnd", prefix: prefix(attribute) };
      } else {
        if (settings.prefixes)
          for (const attribute of mappings)
            yield { kind: "namespaceStart", prefix: prefix(attribute), uri: attribute.value };
        yield {
          kind: "start",
          element: name(node, settings),
          attributes: attributes(node, settings),
        };
        stack.push({ node, exit: true, depth });
        for (const child of Array.from(node.childNodes).reverse())
          stack.push({ node: child, exit: false, depth: depth + 1 });
      }
    } else if (node.nodeType === NodeKind.Text) yield { kind: "text", value: node.nodeValue ?? "" };
    else if (node.nodeType === NodeKind.CDATA) yield { kind: "cdata", value: node.nodeValue ?? "" };
    else if (node.nodeType === NodeKind.Comment)
      yield { kind: "comment", value: node.nodeValue ?? "" };
    else if (node.nodeType === NodeKind.Instruction)
      yield { kind: "instruction", target: node.nodeName, data: node.nodeValue };
  }
}
