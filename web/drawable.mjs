import {drawableStorageFormat} from "../src/runtime/graphics/drawable-format.ts";
// A CAEAGLLayer owns a renderbuffer. WebGL 1 presents the default framebuffer,
// so copy the bound color renderbuffer into a texture and draw it to the canvas.
export function eaglDrawable(context) {
  const storage = new WeakMap();
  let blit, readFramebuffer;

  function allocate(target, drawable, colorFormat) {
    const gl = context();
    if (!drawable || target !== gl.RENDERBUFFER) return 0;
    const rb = gl.getParameter(gl.RENDERBUFFER_BINDING);
    if (!rb) return 0;
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    gl.renderbufferStorage(target, drawableStorageFormat(gl,colorFormat), width, height);
    storage.set(rb, { width, height });
    return 1;
  }
  function shader(gl, kind, source) {
    const sh = gl.createShader(kind);
    gl.shaderSource(sh, source); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw Error('EAGL present shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  }
  function init(gl, vao) {
    const program = gl.createProgram();
    const vert = shader(gl, gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=(p+1.0)*0.5;gl_Position=vec4(p,0.0,1.0);}');
    const frag = shader(gl, gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D image; void main(){gl_FragColor=texture2D(image,uv);}');
    gl.attachShader(program, vert); gl.attachShader(program, frag);
    gl.bindAttribLocation(program, 0, 'p'); gl.linkProgram(program);
    gl.deleteShader(vert); gl.deleteShader(frag);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('EAGL present program: ' + gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    const vertices = vao.createVertexArrayOES(), buffer = gl.createBuffer();
    vao.bindVertexArrayOES(vertices); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const pname of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, pname, gl.NEAREST);
    for (const pname of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, pname, gl.CLAMP_TO_EDGE);
    return { program, vertices, texture, framebuffer: gl.createFramebuffer(), width: 0, height: 0 };
  }
  function present(target) {
    const gl = context();
    const rb = gl.getParameter(gl.RENDERBUFFER_BINDING);
    const size = storage.get(rb);
    if (target !== gl.RENDERBUFFER || !size) return 0;
    if (gl.blitFramebuffer) {
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
        gl.blitFramebuffer(0, 0, size.width, size.height, 0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
          gl.COLOR_BUFFER_BIT, gl.NEAREST);
        return 1;
      } finally {
        if (scissor) gl.enable(gl.SCISSOR_TEST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, savedRead);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, savedDraw);
      }
    }
    const vao = gl.getExtension('OES_vertex_array_object');
    if (!vao) throw Error('EAGL presentation requires OES_vertex_array_object');
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING), program = gl.getParameter(gl.CURRENT_PROGRAM);
    const vertices = gl.getParameter(vao.VERTEX_ARRAY_BINDING_OES), buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const viewport = gl.getParameter(gl.VIEWPORT), mask = gl.getParameter(gl.COLOR_WRITEMASK);
    const units = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const caps = [gl.SCISSOR_TEST, gl.BLEND, gl.CULL_FACE, gl.DEPTH_TEST, gl.STENCIL_TEST,
      gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE].filter(cap => gl.isEnabled(cap));
    try {
      for (const cap of caps) gl.disable(cap);
      blit ??= init(gl, vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blit.framebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Incomplete EAGL drawable');
      gl.bindTexture(gl.TEXTURE_2D, blit.texture);
      if (size.width !== blit.width || size.height !== blit.height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        blit.width = size.width; blit.height = size.height;
      }
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, size.width, size.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.colorMask(true, true, true, true);
      gl.useProgram(blit.program); vao.bindVertexArrayOES(blit.vertices);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return 1;
    } finally {
      vao.bindVertexArrayOES(vertices); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.activeTexture(units);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(...viewport); gl.colorMask(...mask);
      for (const cap of caps) gl.enable(cap);
    }
  }
  return { allocate, present };
}
