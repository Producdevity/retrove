export const HandleKind = {
  Buffer: "Buffer",
  Texture: "Texture",
  Framebuffer: "Framebuffer",
  Renderbuffer: "Renderbuffer",
  Shader: "Shader",
  Program: "Program",
} as const;
export type HandleKind = (typeof HandleKind)[keyof typeof HandleKind];

interface HandleTypes {
  readonly Buffer: WebGLBuffer;
  readonly Texture: WebGLTexture;
  readonly Framebuffer: WebGLFramebuffer;
  readonly Renderbuffer: WebGLRenderbuffer;
  readonly Shader: WebGLShader;
  readonly Program: WebGLProgram;
}

/** Guest-visible names for the WebGL objects a context created. */
export class GlesHandles {
  readonly #numbers = new Map<object, number>();
  readonly #objects = new Map<number, object>();
  readonly #kinds = new Map<number, HandleKind | undefined>();
  readonly #tables: { [Kind in HandleKind]: Map<number, HandleTypes[Kind]> } = {
    Buffer: new Map(),
    Texture: new Map(),
    Framebuffer: new Map(),
    Renderbuffer: new Map(),
    Shader: new Map(),
    Program: new Map(),
  };
  #next = 1;

  buffer(object: WebGLBuffer | null): number {
    return this.#register(object, HandleKind.Buffer, this.#tables.Buffer);
  }
  texture(object: WebGLTexture | null): number {
    return this.#register(object, HandleKind.Texture, this.#tables.Texture);
  }
  framebuffer(object: WebGLFramebuffer | null): number {
    return this.#register(object, HandleKind.Framebuffer, this.#tables.Framebuffer);
  }
  renderbuffer(object: WebGLRenderbuffer | null): number {
    return this.#register(object, HandleKind.Renderbuffer, this.#tables.Renderbuffer);
  }
  shader(object: WebGLShader | null): number {
    return this.#register(object, HandleKind.Shader, this.#tables.Shader);
  }
  program(object: WebGLProgram | null): number {
    return this.#register(object, HandleKind.Program, this.#tables.Program);
  }

  /** A name for an object the driver reported; its kind stays unknown unless it is a native one. */
  any(object: object | null): number {
    if (object === null) return 0;
    const existing = this.#numbers.get(object);
    if (existing !== undefined) return existing;
    const handle = this.#next++;
    this.#numbers.set(object, handle);
    this.#objects.set(handle, object);
    this.#classify(handle, object);
    return handle;
  }

  getBuffer(handle: number): WebGLBuffer | null {
    return this.#get(handle, this.#tables.Buffer);
  }
  getTexture(handle: number): WebGLTexture | null {
    return this.#get(handle, this.#tables.Texture);
  }
  getFramebuffer(handle: number): WebGLFramebuffer | null {
    return this.#get(handle, this.#tables.Framebuffer);
  }
  getRenderbuffer(handle: number): WebGLRenderbuffer | null {
    return this.#get(handle, this.#tables.Renderbuffer);
  }
  getShader(handle: number): WebGLShader | null {
    return this.#get(handle, this.#tables.Shader);
  }
  getProgram(handle: number): WebGLProgram | null {
    return this.#get(handle, this.#tables.Program);
  }

  is(handle: number, kind: HandleKind): boolean {
    return this.#kinds.get(handle) === kind;
  }
  remove(handle: number): void {
    const object = this.#objects.get(handle);
    if (object) this.#numbers.delete(object);
    this.#objects.delete(handle);
    this.#kinds.delete(handle);
    for (const table of Object.values(this.#tables)) table.delete(handle);
  }

  #classify(handle: number, object: object): void {
    if (typeof WebGLBuffer !== "undefined" && object instanceof WebGLBuffer)
      this.#tables.Buffer.set(handle, object);
    else if (typeof WebGLTexture !== "undefined" && object instanceof WebGLTexture)
      this.#tables.Texture.set(handle, object);
    else if (typeof WebGLFramebuffer !== "undefined" && object instanceof WebGLFramebuffer)
      this.#tables.Framebuffer.set(handle, object);
    else if (typeof WebGLRenderbuffer !== "undefined" && object instanceof WebGLRenderbuffer)
      this.#tables.Renderbuffer.set(handle, object);
    else if (typeof WebGLShader !== "undefined" && object instanceof WebGLShader)
      this.#tables.Shader.set(handle, object);
    else if (typeof WebGLProgram !== "undefined" && object instanceof WebGLProgram)
      this.#tables.Program.set(handle, object);
  }
  #register<T extends object>(object: T | null, kind: HandleKind, table: Map<number, T>): number {
    if (object === null) return 0;
    const existing = this.#numbers.get(object);
    if (existing !== undefined) {
      const current = this.#kinds.get(existing);
      if (current && current !== kind) throw new Error("Graphics object type changed.");
      this.#kinds.set(existing, kind);
      table.set(existing, object);
      return existing;
    }
    const handle = this.#next++;
    this.#numbers.set(object, handle);
    this.#objects.set(handle, object);
    this.#kinds.set(handle, kind);
    table.set(handle, object);
    return handle;
  }
  #get<T extends object>(handle: number, table: Map<number, T>): T | null {
    if (!handle) return null;
    const object = table.get(handle);
    if (!object) throw new Error(`Unknown GLES object ${handle}`);
    return object;
  }
}
