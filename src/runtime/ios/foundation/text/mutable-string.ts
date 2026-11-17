import { Argument, type FoundationHost } from "../../objc/host";

const MUTABLE_STRING_CLASS = "NSMutableString";
interface MutableStringHost extends Pick<FoundationHost, "method" | "text"> {
  assign(self: number, value: string): void;
}

// NSString indices and lengths count UTF-16 code units, the same units as JavaScript strings.
function edit(current: string, location: number, length: number, replacement: string): string {
  if (location > current.length || length > current.length - location)
    throw new Error(`NSMutableString range {${location}, ${length}} is out of bounds.`);
  return current.slice(0, location) + replacement + current.slice(location + length);
}

export function installMutableStringEdits(host: MutableStringHost): void {
  host.method(MUTABLE_STRING_CLASS, false, "deleteCharactersInRange:", (self, args) => {
    host.assign(self, edit(host.text(self), args(Argument.First), args(Argument.Second), ""));
  });
  host.method(MUTABLE_STRING_CLASS, false, "insertString:atIndex:", (self, args) => {
    const inserted = host.text(args(Argument.First));
    host.assign(self, edit(host.text(self), args(Argument.Second), 0, inserted));
  });
  host.method(MUTABLE_STRING_CLASS, false, "replaceCharactersInRange:withString:", (self, args) => {
    const replacement = host.text(args(Argument.Third));
    host.assign(
      self,
      edit(host.text(self), args(Argument.First), args(Argument.Second), replacement),
    );
  });
}
