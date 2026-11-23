import {
  anyObjectParameter,
  booleanQuadParameter,
  floatQuadParameter,
  objectParameter,
  type GraphicsContext,
} from "./gl-parameters";

const QUAD_COMPONENTS = 2;
export const QUAD_VERTICES = 4;
const POSITION_ATTRIBUTE = 0;
const UNIT_QUAD = [0, 0, 1, 0, 0, 1, 1, 1];
const VERTEX_SHADER =
  "attribute vec2 p; uniform vec2 origin; uniform vec2 u; uniform vec2 v; varying vec2 uv; void main(){uv=p;gl_Position=vec4(origin+p.x*u+p.y*v,0.0,1.0);}";
const FRAGMENT_SHADER =
  "precision mediump float; varying vec2 uv; uniform sampler2D image; void main(){gl_FragColor=texture2D(image,uv);}";

export interface VertexArrays {
  create(): () => void;
  save(): () => void;
}
export interface PresentQuad {
  readonly arrays: VertexArrays;
  readonly bindVertices: () => void;
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<"origin" | "u" | "v", WebGLUniformLocation | null>>;
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

export function required<T>(value: T | null): T {
  if (value === null) throw new Error("EAGL presentation resources are unavailable");
  return value;
}
function shader(gl: GraphicsContext, kind: number, source: string): WebGLShader {
  const compiled = required(gl.createShader(kind));
  gl.shaderSource(compiled, source);
  gl.compileShader(compiled);
  if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS))
    throw new Error("EAGL present shader: " + String(gl.getShaderInfoLog(compiled)));
  return compiled;
}
export function vertexArrays(gl: GraphicsContext): VertexArrays {
  if ("createVertexArray" in gl && typeof gl.createVertexArray === "function") {
    const native = gl;
    return {
      create: () => {
        const array = native.createVertexArray();
        return () => native.bindVertexArray(array);
      },
      save: () => {
        const array = objectParameter(native, native.VERTEX_ARRAY_BINDING, WebGLVertexArrayObject);
        return () => native.bindVertexArray(array);
      },
    };
  }
  const extension = gl.getExtension("OES_vertex_array_object");
  if (!extension) throw new Error("EAGL presentation requires vertex array objects");
  return {
    create: () => {
      const array = extension.createVertexArrayOES();
      return () => extension.bindVertexArrayOES(array);
    },
    save: () => {
      const array = anyObjectParameter(gl, extension.VERTEX_ARRAY_BINDING_OES);
      return () => extension.bindVertexArrayOES(array);
    },
  };
}
export function createQuad(gl: GraphicsContext, arrays: VertexArrays): PresentQuad {
  const program = required(gl.createProgram());
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, POSITION_ATTRIBUTE, "p");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("EAGL present program: " + String(gl.getProgramInfoLog(program)));
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "image"), 0);
  const uniforms = {
    origin: gl.getUniformLocation(program, "origin"),
    u: gl.getUniformLocation(program, "u"),
    v: gl.getUniformLocation(program, "v"),
  };
  const bindVertices = arrays.create(),
    buffer = gl.createBuffer();
  bindVertices();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(UNIT_QUAD), gl.STATIC_DRAW);
  gl.vertexAttribPointer(POSITION_ATTRIBUTE, QUAD_COMPONENTS, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(POSITION_ATTRIBUTE);
  const texture = required(gl.createTexture());
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
    gl.texParameteri(gl.TEXTURE_2D, name, gl.LINEAR);
  for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
    gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE);
  return {
    arrays,
    bindVertices,
    program,
    uniforms,
    texture,
    framebuffer: required(gl.createFramebuffer()),
    width: 0,
    height: 0,
  };
}
export function clearDisplay(gl: GraphicsContext): void {
  const color = floatQuadParameter(gl, gl.COLOR_CLEAR_VALUE),
    mask = booleanQuadParameter(gl, gl.COLOR_WRITEMASK);
  gl.clearColor(0, 0, 0, 1);
  gl.colorMask(true, true, true, true);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.clearColor(...color);
  gl.colorMask(...mask);
}
