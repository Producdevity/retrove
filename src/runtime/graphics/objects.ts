export const GraphicsKind = {
  Buffer: "Buffer",
  Texture: "Texture",
  Framebuffer: "Framebuffer",
  Renderbuffer: "Renderbuffer",
  Shader: "Shader",
  Program: "Program",
} as const;
export type GraphicsKind = (typeof GraphicsKind)[keyof typeof GraphicsKind];
interface Entry {
  readonly object: object;
  kind: GraphicsKind | undefined;
}
export class GraphicsObjects {
  private readonly entries = new Map<number, Entry>();
  private readonly handles = new Map<object, number>();
  private next = 1;
  register(object: object | null, kind?: GraphicsKind): number {
    if (object === null) return 0;
    const existing = this.handles.get(object);
    if (existing !== undefined) {
      const entry = this.entries.get(existing);
      if (entry && kind) {
        if (entry.kind && entry.kind !== kind) throw new Error("Graphics object type changed.");
        entry.kind = kind;
      }
      return existing;
    }
    const handle = this.next++;
    this.handles.set(object, handle);
    this.entries.set(handle, { object, kind });
    return handle;
  }
  get(handle: number): object | null {
    if (!handle) return null;
    const entry = this.entries.get(handle);
    if (!entry) throw new Error(`Unknown GLES object ${handle}`);
    return entry.object;
  }
  is(handle: number, kind: GraphicsKind): boolean {
    return this.entries.get(handle)?.kind === kind;
  }
  remove(handle: number): void {
    const entry = this.entries.get(handle);
    if (entry) this.handles.delete(entry.object);
    this.entries.delete(handle);
  }
}
