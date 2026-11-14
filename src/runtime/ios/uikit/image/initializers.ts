import type { FoundationHost, HostResult } from "../../objc/host";
interface ImageHost extends Pick<FoundationHost, "method" | "retain" | "release"> {
  imageClass(): number;
  send(self: number, selector: string, args: number[]): Promise<HostResult>;
}
export function installImageInitializers(host: ImageHost): void {
  host.method("UIImage", false, "initWithContentsOfFile:", async (self, args) => {
    const result = await host.send(host.imageClass(), "imageWithContentsOfFile:", [args(0)]);
    if (typeof result !== "number") throw new Error("Invalid UIImage factory result.");
    const image = host.retain(result);
    await host.release(self);
    return image;
  });
}
