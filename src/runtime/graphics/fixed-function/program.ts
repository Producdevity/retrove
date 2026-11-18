import { Attribute, programKey, shaderSource, type FixedDrawState } from "./shader";

const PROGRAM_CACHE_LIMIT = 64;
type Context = WebGLRenderingContext | WebGL2RenderingContext;
function compile(gl: Context, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate an ES 1 shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`ES 1 shader compilation failed: ${message ?? "no driver message"}`);
  }
  return shader;
}
function link(gl: Context, state: FixedDrawState) {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate an ES 1 shader program.");
  let vertex: WebGLShader | undefined, fragment: WebGLShader | undefined;
  try {
    const source = shaderSource(state);
    vertex = compile(gl, gl.VERTEX_SHADER, source.vertex);
    fragment = compile(gl, gl.FRAGMENT_SHADER, source.fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, Attribute.Position, "aPosition");
    gl.bindAttribLocation(program, Attribute.Color, "aColor");
    if (state.pointSizeArray) gl.bindAttribLocation(program, Attribute.PointSize, "aPointSize");
    state.textures.forEach((_stage, unit) =>
      gl.bindAttribLocation(program, Attribute.TextureStart + unit, `aTexture${unit}`),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(
        `ES 1 program link failed: ${gl.getProgramInfoLog(program) ?? "no driver message"}`,
      );
    return {
      program,
      modelView: gl.getUniformLocation(program, "uModelView"),
      projection: gl.getUniformLocation(program, "uProjection"),
      pointSize: gl.getUniformLocation(program, "uPointSize"),
      alphaReference: gl.getUniformLocation(program, "uAlphaReference"),
      textures: state.textures.map((_stage, unit) => ({
        matrix: gl.getUniformLocation(program, `uTextureMatrix${unit}`),
        environment: gl.getUniformLocation(program, `uEnvironment${unit}`),
        sampler: gl.getUniformLocation(program, `uTexture${unit}`),
      })),
    };
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}
export class FixedPrograms {
  private readonly cache = new Map<string, ReturnType<typeof link>>();
  constructor(private readonly gl: Context) {}
  apply(state: FixedDrawState): void {
    const key = programKey(state),
      gl = this.gl;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = link(gl, state);
      if (this.cache.size >= PROGRAM_CACHE_LIMIT) {
        const first = this.cache.entries().next().value;
        if (first) {
          gl.deleteProgram(first[1].program);
          this.cache.delete(first[0]);
        }
      }
    } else this.cache.delete(key);
    this.cache.set(key, entry);
    gl.useProgram(entry.program);
    gl.uniformMatrix4fv(entry.modelView, false, state.modelView);
    gl.uniformMatrix4fv(entry.projection, false, state.projection);
    gl.uniform1f(entry.pointSize, state.pointSize);
    gl.uniform1f(entry.alphaReference, Math.min(1, Math.max(0, state.alphaReference)));
    for (const [unit, locations] of entry.textures.entries()) {
      const stage = state.textures[unit];
      if (!stage?.enabled) continue;
      gl.uniformMatrix4fv(locations.matrix, false, stage.matrix);
      gl.uniform4f(locations.environment, ...stage.color);
      gl.uniform1i(locations.sampler, unit);
    }
  }
  close(): void {
    for (const entry of this.cache.values()) this.gl.deleteProgram(entry.program);
    this.cache.clear();
  }
}
