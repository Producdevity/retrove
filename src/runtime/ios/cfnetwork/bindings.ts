import { WORD_BYTES } from "../abi/scalars";
import { Argument } from "../objc/host";
import type { RunLoopSources } from "../foundation/run-loop-sources";
import type { CFNetworkHost } from "./host";
import { HttpMessage } from "./http-message";
import { OfflineStreams } from "./streams";
import { CFNetworkIntegers } from "./symbols";

export type { CFNetworkHost } from "./host";
export { CFNetworkStrings } from "./symbols";
const MESSAGE_CLASS = "__CFHTTPMessage";
const Fourth = 3;
type Arguments = (index: number) => number;
type Functions = Record<string, (args: Arguments) => unknown>;

class Messages {
  readonly values = new Map<number, HttpMessage>();
  private readonly klass: number;
  constructor(private readonly host: CFNetworkHost) {
    this.klass = host.hostClass(MESSAGE_CLASS, "NSObject");
    host.method(MESSAGE_CLASS, false, "dealloc", (self) => {
      this.values.delete(self);
      host.destroy(self);
    });
  }
  create(message: HttpMessage): number {
    const pointer = this.host.alloc(this.klass);
    this.values.set(pointer, message);
    return pointer;
  }
  get(pointer: number): HttpMessage {
    const message = this.values.get(pointer);
    if (!message) throw new Error("Invalid CFHTTPMessage.");
    return message;
  }
  text(pointer: number): string | undefined {
    return pointer ? this.host.text(pointer) : undefined;
  }
  owned(value: string | undefined): number {
    return value === undefined ? 0 : this.host.retain(this.host.string(value));
  }
}

function messageFunctions(host: CFNetworkHost, messages: Messages): Functions {
  const message = (a: Arguments) => messages.get(a(Argument.First));
  return {
    _CFHTTPMessageCreateRequest: async (a) =>
      messages.create(
        HttpMessage.request(
          host.text(a(Argument.Second)),
          await host.urlString(a(Argument.Third)),
          host.text(a(Fourth)),
        ),
      ),
    _CFHTTPMessageCreateResponse: (a) =>
      messages.create(
        HttpMessage.response(
          a(Argument.Second),
          messages.text(a(Argument.Third)) ?? "",
          host.text(a(Fourth)),
        ),
      ),
    _CFHTTPMessageCreateEmpty: (a) => messages.create(new HttpMessage(Boolean(a(Argument.Second)))),
    _CFHTTPMessageSetHeaderFieldValue: (a) => {
      message(a).setHeader(host.text(a(Argument.Second)), messages.text(a(Argument.Third)));
    },
    _CFHTTPMessageCopyHeaderFieldValue: (a) =>
      messages.owned(message(a).header(host.text(a(Argument.Second)))),
    _CFHTTPMessageCopyAllHeaderFields: (a) => host.ownedDictionary(message(a).allHeaders()),
    _CFHTTPMessageCopyRequestMethod: (a) => messages.owned(message(a).method || undefined),
    _CFHTTPMessageCopyRequestURL: (a) => {
      const url = message(a).url;
      return url ? host.ownedURL(url) : 0;
    },
    _CFHTTPMessageCopyVersion: (a) => messages.owned(message(a).version),
    _CFHTTPMessageCopyResponseStatusLine: (a) => {
      const value = message(a);
      return value.request || !value.headerComplete ? 0 : messages.owned(value.statusLine());
    },
    _CFHTTPMessageGetResponseStatusCode: (a) => message(a).status,
    _CFHTTPMessageIsHeaderComplete: (a) => Number(message(a).headerComplete),
    _CFHTTPMessageAppendBytes: (a) =>
      Number(message(a).append(host.readBytes(a(Argument.Second), a(Argument.Third)))),
    _CFHTTPMessageCopySerializedMessage: (a) => host.ownedData(message(a).serialize()),
    _CFHTTPMessageSetBody: (a) => {
      message(a).body = a(Argument.Second) ? host.dataBytes(a(Argument.Second)) : new Uint8Array();
    },
    _CFHTTPMessageCopyBody: (a) => host.ownedData(message(a).body),
    _CFHTTPMessageApplyCredentialDictionary: () => 0,
  };
}
function streamFunctions(streams: OfflineStreams): Functions {
  const functions: Functions = {
    _CFReadStreamCreateForHTTPRequest: (a) => streams.create([a(Argument.Second)]),
    _CFReadStreamCreateForStreamedHTTPRequest: (a) =>
      streams.create([a(Argument.Second), a(Argument.Third)]),
    _CFReadStreamRead: () => streams.read(),
    _CFReadStreamHasBytesAvailable: () => 0,
  };
  for (const kind of ["Read", "Write"]) {
    const name = (suffix: string) => `_CF${kind}Stream${suffix}`;
    functions[name("Open")] = (a: Arguments) => streams.open(a(Argument.First));
    functions[name("Close")] = (a: Arguments) => {
      streams.close(a(Argument.First));
    };
    functions[name("GetStatus")] = (a: Arguments) => streams.status(a(Argument.First));
    functions[name("GetError")] = (a: Arguments) => {
      streams.writeError(a(Argument.First), a(Argument.Second));
    };
    functions[name("CopyError")] = (a: Arguments) => streams.copyError(a(Argument.First));
    functions[name("SetClient")] = (a: Arguments) =>
      streams.setClient(a(Argument.First), a(Argument.Second), a(Argument.Third), a(Fourth));
    functions[name("ScheduleWithRunLoop")] = (a: Arguments) =>
      streams.schedule(a(Argument.First), a(Argument.Second), a(Argument.Third));
    functions[name("UnscheduleFromRunLoop")] = (a: Arguments) =>
      streams.unschedule(a(Argument.First), a(Argument.Second), a(Argument.Third));
    functions[name("SetProperty")] = (a: Arguments) =>
      streams.setProperty(a(Argument.First), a(Argument.Second), a(Argument.Third));
    functions[name("CopyProperty")] = (a: Arguments) =>
      streams.copyProperty(a(Argument.First), a(Argument.Second));
  }
  functions["_CFWriteStreamWrite"] = () => streams.read();
  functions["_CFWriteStreamCanAcceptBytes"] = () => 0;
  return functions;
}

/** No proxy is configured, so every URL connects directly. */
function proxyFunctions(host: CFNetworkHost): Functions {
  const direct = async (): Promise<number> => {
    const entry = host.ownedDictionary({ kCFProxyTypeKey: "kCFProxyTypeNone" });
    try {
      return host.ownedArray([entry]);
    } finally {
      await host.release(entry);
    }
  };
  return {
    _CFNetworkCopySystemProxySettings: () => host.ownedDictionary({}),
    _CFNetworkCopyProxiesForURL: direct,
    _CFNetworkCopyProxiesForAutoConfigurationScript: direct,
  };
}
/** CFHTTPMessage and HTTP streams; requests fail as they do on a phone without a network. */
export function installCFNetwork(
  host: CFNetworkHost,
  sources: RunLoopSources,
): { functions: Functions; data(name: string): number | undefined } {
  const integers = new Map<string, number>();
  return {
    functions: {
      ...messageFunctions(host, new Messages(host)),
      ...streamFunctions(new OfflineStreams(host, sources)),
      ...proxyFunctions(host),
    },
    data(name) {
      const value = CFNetworkIntegers[name];
      if (value === undefined) return undefined;
      let address = integers.get(name);
      if (address === undefined) {
        address = host.zero(WORD_BYTES);
        host.write(address, value);
        integers.set(name, address);
      }
      return address;
    },
  };
}
