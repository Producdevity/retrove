import { Argument, type FoundationHost } from "../objc/host";

export const DataField = { Bytes: 4, Length: 8 } as const;
interface DataHost extends Pick<FoundationHost, "method" | "alloc" | "autorelease"> {
  bytes(pointer: number): number;
  length(pointer: number): number;
  create(source: number, length: number, pointer: number): number;
  resize(pointer: number, length: number): void;
  read(source: number, length: number): Uint8Array;
  write(pointer: number, offset: number, bytes: Uint8Array): void;
}
export function installDataFactories(host: DataHost): void {
  const dataClass = "NSData",
    mutableClass = "NSMutableData";
  host.method(dataClass, true, "data", (cls) => host.autorelease(host.alloc(cls)));
  host.method(dataClass, true, "dataWithBytes:length:", (cls, args) =>
    host.autorelease(host.create(args(Argument.First), args(Argument.Second), host.alloc(cls))),
  );
  host.method(dataClass, true, "dataWithData:", (cls, args) => {
    const source = args(Argument.First);
    return host.autorelease(host.create(host.bytes(source), host.length(source), host.alloc(cls)));
  });
  host.method(mutableClass, false, "initWithLength:", (self, args) => {
    host.resize(self, args(Argument.First));
    return self;
  });
  host.method(mutableClass, false, "initWithCapacity:", (self) => self);
  host.method(mutableClass, false, "appendBytes:length:", (self, args) => {
    const bytes = host.read(args(Argument.First), args(Argument.Second));
    const previous = host.length(self);
    host.resize(self, previous + bytes.length);
    host.write(self, previous, bytes);
  });
}

interface StringDataHost extends Pick<FoundationHost, "method"> {
  send(pointer: number, selector: string, args: number[]): Promise<number>;
}
export function installStringDataEncoding(host: StringDataHost): void {
  host.method("NSString", false, "dataUsingEncoding:", (self, args) =>
    host.send(self, "dataUsingEncoding:allowLossyConversion:", [args(Argument.First), 0]),
  );
}
