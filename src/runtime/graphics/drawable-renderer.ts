import { drawableStorageFormat } from "./drawable-format";
import {
  blitRectangle,
  coversDisplay,
  isAxisAligned,
  type DrawablePlacement,
} from "./drawable-placement";
import {
  clearDisplay,
  QUAD_VERTICES,
  createQuad,
  required,
  vertexArrays,
  type PresentQuad,
} from "./drawable-quad";
import {
  booleanQuadParameter,
  hasBlit,
  integerQuadParameter,
  numberParameter,
  objectParameter,
  type GraphicsContext,
} from "./gl-parameters";

export interface DrawableSize {
  readonly width: number;
  readonly height: number;
}
export interface DrawableRenderer {
  /** The storage size, or undefined when no renderbuffer was allocated. */
  allocate(
    target: number,
    drawable: number,
    colorFormat: string,
    size: DrawableSize | null | undefined,
  ): DrawableSize | undefined;
  present(target: number, placement: (drawable: number) => DrawablePlacement): number;
}

const PRESENTED = 1;
interface Storage extends DrawableSize {
  readonly drawable: number;
}
/** Renderbuffer storage and presentation where the WebGL context lives. */
class Presenter implements DrawableRenderer {
  readonly #storage = new WeakMap<WebGLRenderbuffer, Storage>();
  #quad: PresentQuad | undefined;
  #readFramebuffer: WebGLFramebuffer | undefined;
  constructor(private readonly context: () => GraphicsContext) {}

  allocate(
    target: number,
    drawable: number,
    colorFormat: string,
    given: DrawableSize | null | undefined,
  ): DrawableSize | undefined {
    const gl = this.context();
    if (!drawable || target !== gl.RENDERBUFFER) return undefined;
    const renderbuffer = objectParameter(gl, gl.RENDERBUFFER_BINDING, WebGLRenderbuffer);
    if (!renderbuffer) return undefined;
    const size = given ?? { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
    gl.renderbufferStorage(target, drawableStorageFormat(gl, colorFormat), size.width, size.height);
    this.#storage.set(renderbuffer, { width: size.width, height: size.height, drawable });
    return size;
  }

  present(target: number, placementOf: (drawable: number) => DrawablePlacement): number {
    const gl = this.context();
    const renderbuffer = objectParameter(gl, gl.RENDERBUFFER_BINDING, WebGLRenderbuffer);
    const size = renderbuffer ? this.#storage.get(renderbuffer) : undefined;
    if (!renderbuffer || target !== gl.RENDERBUFFER || !size) return 0;
    const placement = placementOf(size.drawable);
    return hasBlit(gl) && isAxisAligned(placement)
      ? this.#blit(gl, renderbuffer, size, placement)
      : this.#draw(gl, renderbuffer, size, placement);
  }

  #readBuffer(gl: GraphicsContext): WebGLFramebuffer {
    this.#readFramebuffer ??= required(gl.createFramebuffer());
    return this.#readFramebuffer;
  }

  #blit(
    gl: WebGL2RenderingContext,
    renderbuffer: WebGLRenderbuffer,
    size: DrawableSize,
    placement: DrawablePlacement,
  ): number {
    const savedRead = objectParameter(gl, gl.READ_FRAMEBUFFER_BINDING, WebGLFramebuffer);
    const savedDraw = objectParameter(gl, gl.DRAW_FRAMEBUFFER_BINDING, WebGLFramebuffer);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.#readBuffer(gl));
      gl.framebufferRenderbuffer(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.RENDERBUFFER,
        renderbuffer,
      );
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("Incomplete EAGL drawable");
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      if (scissor) gl.disable(gl.SCISSOR_TEST);
      if (!coversDisplay(placement)) clearDisplay(gl);
      const [x0, y0, x1, y1] = blitRectangle(placement, {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
      });
      const exact = Math.abs(x1 - x0) === size.width && Math.abs(y1 - y0) === size.height;
      gl.blitFramebuffer(
        0,
        0,
        size.width,
        size.height,
        x0,
        y0,
        x1,
        y1,
        gl.COLOR_BUFFER_BIT,
        exact ? gl.NEAREST : gl.LINEAR,
      );
      return PRESENTED;
    } finally {
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, savedRead);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, savedDraw);
    }
  }

  /** WebGL 2 blits so any renderbuffer format converts; WebGL 1 can only copy into the texture. */
  #upload(
    gl: GraphicsContext,
    quad: PresentQuad,
    renderbuffer: WebGLRenderbuffer,
    size: DrawableSize,
  ): void {
    gl.bindTexture(gl.TEXTURE_2D, quad.texture);
    if (size.width !== quad.width || size.height !== quad.height) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        size.width,
        size.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      quad.width = size.width;
      quad.height = size.height;
    }
    if (hasBlit(gl)) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.#readBuffer(gl));
      gl.framebufferRenderbuffer(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.RENDERBUFFER,
        renderbuffer,
      );
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, quad.framebuffer);
      gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        quad.texture,
        0,
      );
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("Incomplete EAGL drawable");
      gl.blitFramebuffer(
        0,
        0,
        size.width,
        size.height,
        0,
        0,
        size.width,
        size.height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, quad.framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("Incomplete EAGL drawable");
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, size.width, size.height);
  }

  #draw(
    gl: GraphicsContext,
    renderbuffer: WebGLRenderbuffer,
    size: DrawableSize,
    placement: DrawablePlacement,
  ): number {
    const arrays = this.#quad?.arrays ?? vertexArrays(gl);
    const framebuffer = objectParameter(gl, gl.FRAMEBUFFER_BINDING, WebGLFramebuffer),
      program = objectParameter(gl, gl.CURRENT_PROGRAM, WebGLProgram);
    const readBinding = hasBlit(gl)
      ? objectParameter(gl, gl.READ_FRAMEBUFFER_BINDING, WebGLFramebuffer)
      : undefined;
    const restoreVertices = arrays.save(),
      buffer = objectParameter(gl, gl.ARRAY_BUFFER_BINDING, WebGLBuffer);
    const viewport = integerQuadParameter(gl, gl.VIEWPORT),
      mask = booleanQuadParameter(gl, gl.COLOR_WRITEMASK);
    const units = numberParameter(gl, gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const texture = objectParameter(gl, gl.TEXTURE_BINDING_2D, WebGLTexture);
    const caps = [
      gl.SCISSOR_TEST,
      gl.BLEND,
      gl.CULL_FACE,
      gl.DEPTH_TEST,
      gl.STENCIL_TEST,
      gl.SAMPLE_ALPHA_TO_COVERAGE,
      gl.SAMPLE_COVERAGE,
    ].filter((cap) => gl.isEnabled(cap));
    try {
      for (const cap of caps) gl.disable(cap);
      const quad = (this.#quad ??= createQuad(gl, arrays));
      this.#upload(gl, quad, renderbuffer, size);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      if (!coversDisplay(placement)) clearDisplay(gl);
      gl.colorMask(true, true, true, true);
      gl.useProgram(quad.program);
      quad.bindVertices();
      gl.uniform2f(quad.uniforms.origin, ...placement.origin);
      gl.uniform2f(quad.uniforms.u, ...placement.u);
      gl.uniform2f(quad.uniforms.v, ...placement.v);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES);
      return PRESENTED;
    } finally {
      restoreVertices();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(units);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (readBinding !== undefined && hasBlit(gl))
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readBinding);
      gl.viewport(...viewport);
      gl.colorMask(...mask);
      for (const cap of caps) gl.enable(cap);
    }
  }
}

export function drawableRenderer(context: () => GraphicsContext): DrawableRenderer {
  return new Presenter(context);
}
