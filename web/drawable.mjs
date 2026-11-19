import {drawableStorageFormat} from "../src/runtime/graphics/drawable-format.ts";
import {blitRectangle, coversDisplay, drawablePlacement, drawableSize, isAxisAligned} from "../src/runtime/graphics/drawable-placement.ts";
export const FULL_DISPLAY = {origin:[-1,-1], u:[2,0], v:[0,2]};
const placementOf = layer => layer?.display ? drawablePlacement(layer) : FULL_DISPLAY;
const allocated = (layer, size) => ({width:size?.width, height:size?.height, points:layer && [layer.width, layer.height], scale:layer?.scale});

// A CAEAGLLayer owns a renderbuffer sized from its bounds and contents scale. Presenting draws it
// where UIKit places the layer, turned when a portrait layer shows in a landscape interface.
export function eaglDrawable(context, geometry = () => undefined, diagnostic = () => {}) {
  const renderer = drawableRenderer(context);
  return {
    allocate(target, drawable, colorFormat) {
      const layer = geometry(drawable), size = renderer.allocate(target, drawable, colorFormat, layer && drawableSize(layer));
      if (size) diagnostic('info', 'graphics', 'Drawable allocated', allocated(layer, size));
      return size ? 1 : 0;
    },
    present: target => renderer.present(target, drawable => placementOf(geometry(drawable))),
  };
}

// The same drawable for a WebGL context another thread owns: UIKit geometry stays here, so each
// command carries the sizes and placements the owner needs.
export function remoteDrawable(command, geometry = () => undefined, diagnostic = () => {}) {
  const drawables = new Set();
  return {
    allocate(target, drawable, colorFormat) {
      const layer = geometry(drawable), size = (layer && drawableSize(layer)) ?? null;
      const result = command('allocate', {target, drawable, colorFormat, size});
      if (result) {
        drawables.add(drawable);
        diagnostic('info', 'graphics', 'Drawable allocated', allocated(layer, size));
      }
      return result;
    },
    present: target => command('present', {target, placements: [...drawables].map(drawable => [drawable, placementOf(geometry(drawable))])}),
  };
}

// Renderbuffer storage and presentation where the WebGL context lives. `size` defaults to the
// drawing buffer; `placement` maps a drawable to where it shows.
export function drawableRenderer(context) {
  const storage = new WeakMap();
  let quad, readFramebuffer;

  function allocate(target, drawable, colorFormat, size) {
    const gl = context();
    if (!drawable || target !== gl.RENDERBUFFER) return undefined;
    const rb = gl.getParameter(gl.RENDERBUFFER_BINDING);
    if (!rb) return undefined;
    size ??= {width:gl.drawingBufferWidth, height:gl.drawingBufferHeight};
    gl.renderbufferStorage(target, drawableStorageFormat(gl,colorFormat), size.width, size.height);
    storage.set(rb, {width:size.width, height:size.height, drawable});
    return size;
  }
  function shader(gl, kind, source) {
    const sh = gl.createShader(kind);
    gl.shaderSource(sh, source); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw Error('EAGL present shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  }
  function vertexArrays(gl) {
    if (typeof gl.createVertexArray === 'function')
      return {create:()=>gl.createVertexArray(), bind:v=>gl.bindVertexArray(v), binding:gl.VERTEX_ARRAY_BINDING};
    const ext = gl.getExtension('OES_vertex_array_object');
    if (!ext) throw Error('EAGL presentation requires vertex array objects');
    return {create:()=>ext.createVertexArrayOES(), bind:v=>ext.bindVertexArrayOES(v), binding:ext.VERTEX_ARRAY_BINDING_OES};
  }
  function init(gl, arrays) {
    const program = gl.createProgram();
    const vert = shader(gl, gl.VERTEX_SHADER, 'attribute vec2 p; uniform vec2 origin; uniform vec2 u; uniform vec2 v; varying vec2 uv; void main(){uv=p;gl_Position=vec4(origin+p.x*u+p.y*v,0.0,1.0);}');
    const frag = shader(gl, gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D image; void main(){gl_FragColor=texture2D(image,uv);}');
    gl.attachShader(program, vert); gl.attachShader(program, frag);
    gl.bindAttribLocation(program, 0, 'p'); gl.linkProgram(program);
    gl.deleteShader(vert); gl.deleteShader(frag);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('EAGL present program: ' + gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    const uniforms = Object.fromEntries(['origin','u','v'].map(name => [name, gl.getUniformLocation(program, name)]));
    const vertices = arrays.create(), buffer = gl.createBuffer();
    arrays.bind(vertices); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const pname of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, pname, gl.LINEAR);
    for (const pname of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, pname, gl.CLAMP_TO_EDGE);
    return { arrays, program, uniforms, vertices, texture, framebuffer: gl.createFramebuffer(), width: 0, height: 0 };
  }
  function clearDisplay(gl) {
    const color = gl.getParameter(gl.COLOR_CLEAR_VALUE), mask = gl.getParameter(gl.COLOR_WRITEMASK);
    gl.clearColor(0, 0, 0, 1); gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(...color); gl.colorMask(...mask);
  }
  function blit(gl, rb, size, placement) {
    const savedRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const savedDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    try {
      readFramebuffer ??= gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
      gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw Error('Incomplete EAGL drawable');
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      if (scissor) gl.disable(gl.SCISSOR_TEST);
      if (!coversDisplay(placement)) clearDisplay(gl);
      const [x0, y0, x1, y1] = blitRectangle(placement, {width:gl.drawingBufferWidth, height:gl.drawingBufferHeight});
      const exact = Math.abs(x1 - x0) === size.width && Math.abs(y1 - y0) === size.height;
      gl.blitFramebuffer(0, 0, size.width, size.height, x0, y0, x1, y1, gl.COLOR_BUFFER_BIT, exact ? gl.NEAREST : gl.LINEAR);
      return 1;
    } finally {
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, savedRead);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, savedDraw);
    }
  }
  // WebGL 2 blits so any renderbuffer format converts; WebGL 1 can only copy into the texture.
  function upload(gl, rb, size) {
    gl.bindTexture(gl.TEXTURE_2D, quad.texture);
    if (size.width !== quad.width || size.height !== quad.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      quad.width = size.width; quad.height = size.height;
    }
    if (gl.blitFramebuffer) {
      readFramebuffer ??= gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
      gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, quad.framebuffer);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, quad.texture, 0);
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Incomplete EAGL drawable');
      gl.blitFramebuffer(0, 0, size.width, size.height, 0, 0, size.width, size.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, quad.framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Incomplete EAGL drawable');
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, size.width, size.height);
  }
  function draw(gl, rb, size, placement) {
    const arrays = quad?.arrays ?? vertexArrays(gl);
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING), program = gl.getParameter(gl.CURRENT_PROGRAM);
    const readBinding = gl.READ_FRAMEBUFFER_BINDING ? gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) : undefined;
    const vertices = gl.getParameter(arrays.binding), buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const viewport = gl.getParameter(gl.VIEWPORT), mask = gl.getParameter(gl.COLOR_WRITEMASK);
    const units = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const caps = [gl.SCISSOR_TEST, gl.BLEND, gl.CULL_FACE, gl.DEPTH_TEST, gl.STENCIL_TEST,
      gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE].filter(cap => gl.isEnabled(cap));
    try {
      for (const cap of caps) gl.disable(cap);
      quad ??= init(gl, arrays);
      upload(gl, rb, size);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      if (!coversDisplay(placement)) clearDisplay(gl);
      gl.colorMask(true, true, true, true);
      gl.useProgram(quad.program); arrays.bind(quad.vertices);
      for (const name of ['origin','u','v']) gl.uniform2f(quad.uniforms[name], ...placement[name]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return 1;
    } finally {
      arrays.bind(vertices); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.activeTexture(units);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (readBinding !== undefined) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readBinding);
      gl.viewport(...viewport); gl.colorMask(...mask);
      for (const cap of caps) gl.enable(cap);
    }
  }
  function present(target, placementOfDrawable) {
    const gl = context();
    const rb = gl.getParameter(gl.RENDERBUFFER_BINDING);
    const size = storage.get(rb);
    if (target !== gl.RENDERBUFFER || !size) return 0;
    const placement = placementOfDrawable(size.drawable);
    return gl.blitFramebuffer && isAxisAligned(placement) ? blit(gl, rb, size, placement) : draw(gl, rb, size, placement);
  }
  return { allocate, present };
}
