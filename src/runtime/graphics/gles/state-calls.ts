import type { GuestArguments } from "../../ios/objc/host";
import type { GraphicsContext } from "../gl-parameters";
import { float, words2, words3, words4 } from "./arguments";
import { PACK_ALIGNMENTS, Gles } from "./constants";
import type { GlesContext } from "./context";

type StateCall = (gl: GraphicsContext, a: GuestArguments) => unknown;
const booleans = (a: GuestArguments): [boolean, boolean, boolean, boolean] => {
  const [red, green, blue, alpha] = words4(a);
  return [Boolean(red), Boolean(green), Boolean(blue), Boolean(alpha)];
};
const floats4 = (a: GuestArguments): [number, number, number, number] => {
  const [first, second, third, fourth] = words4(a);
  return [float(first), float(second), float(third), float(fourth)];
};
const floats2 = (a: GuestArguments): [number, number] => {
  const [first, second] = words2(a);
  return [float(first), float(second)];
};

const PASS_THROUGH: Readonly<Record<string, StateCall>> = {
  BlendEquation: (gl, a) => gl.blendEquation(a(0)),
  BlendEquationSeparate: (gl, a) => gl.blendEquationSeparate(...words2(a)),
  BlendFunc: (gl, a) => gl.blendFunc(...words2(a)),
  BlendFuncSeparate: (gl, a) => gl.blendFuncSeparate(...words4(a)),
  Clear: (gl, a) => gl.clear(a(0)),
  ClearStencil: (gl, a) => gl.clearStencil(a(0)),
  ColorMask: (gl, a) => gl.colorMask(...booleans(a)),
  CullFace: (gl, a) => gl.cullFace(a(0)),
  DepthFunc: (gl, a) => gl.depthFunc(a(0)),
  DepthMask: (gl, a) => gl.depthMask(Boolean(a(0))),
  Disable: (gl, a) => gl.disable(a(0)),
  Enable: (gl, a) => gl.enable(a(0)),
  Finish: (gl) => gl.finish(),
  Flush: (gl) => gl.flush(),
  FrontFace: (gl, a) => gl.frontFace(a(0)),
  GenerateMipmap: (gl, a) => gl.generateMipmap(a(0)),
  Hint: (gl, a) => gl.hint(...words2(a)),
  Scissor: (gl, a) => gl.scissor(...words4(a)),
  StencilFunc: (gl, a) => gl.stencilFunc(...words3(a)),
  StencilFuncSeparate: (gl, a) => gl.stencilFuncSeparate(...words4(a)),
  StencilMask: (gl, a) => gl.stencilMask(a(0)),
  StencilMaskSeparate: (gl, a) => gl.stencilMaskSeparate(...words2(a)),
  StencilOp: (gl, a) => gl.stencilOp(...words3(a)),
  StencilOpSeparate: (gl, a) => gl.stencilOpSeparate(...words4(a)),
  TexParameteri: (gl, a) => gl.texParameteri(...words3(a)),
  Viewport: (gl, a) => gl.viewport(...words4(a)),
  CheckFramebufferStatus: (gl, a) => gl.checkFramebufferStatus(a(0)),
  IsEnabled: (gl, a) => gl.isEnabled(a(0)),
  ClearColor: (gl, a) => gl.clearColor(...floats4(a)),
  ClearDepthf: (gl, a) => gl.clearDepth(float(a(0))),
  DepthRangef: (gl, a) => gl.depthRange(...floats2(a)),
  BlendColor: (gl, a) => gl.blendColor(...floats4(a)),
  LineWidth: (gl, a) => gl.lineWidth(float(a(0))),
  PolygonOffset: (gl, a) => gl.polygonOffset(...floats2(a)),
};

/** Fixed state, pixel storage and error queries that forward straight to the context. */
export function installStateCalls(host: GlesContext): void {
  for (const [name, call] of Object.entries(PASS_THROUGH))
    host.bind(name, (a) => call(host.gl(), a));
  host.bind("ActiveTexture", (a) => {
    host.gl().activeTexture(a(0));
    host.shadowed((shadow) => shadow.activeTexture(a(0)));
  });
  host.bind("SampleCoverage", (a) => host.gl().sampleCoverage(float(a(0)), Boolean(a(1))));
  host.bind("TexParameterf", (a) => {
    const [target, name, value] = words3(a);
    host.gl().texParameterf(target, name, float(value));
  });
  host.bind("PixelStorei", (a) => {
    const [name, value] = words2(a);
    host.gl().pixelStorei(name, value);
    if (!PACK_ALIGNMENTS.includes(value)) return;
    if (name === Gles.UnpackAlignment) host.unpackAlign = value;
    if (name === Gles.PackAlignment) host.packAlign = value;
  });
  host.bind("GetError", () => {
    const code = host.errors.take(() => host.gl().getError(), performance.now());
    host.flagErrors(0);
    return code;
  });
}
