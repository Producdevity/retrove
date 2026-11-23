import { write32 } from "../../memory/guest-memory";
import { hasBlit, objectParameter, type GraphicsContext } from "../gl-parameters";
import { words3, words4, words5 } from "./arguments";
import { Gles } from "./constants";
import type { GlesContext } from "./context";
import { numeric } from "./data";

function hasMultisample(gl: GraphicsContext): gl is WebGL2RenderingContext {
  return (
    "renderbufferStorageMultisample" in gl &&
    typeof gl.renderbufferStorageMultisample === "function"
  );
}

function resolveMultisample(host: GlesContext): void {
  const g = host.gl();
  if (!hasBlit(g) || !g.getParameter(g.READ_FRAMEBUFFER_BINDING)) {
    host.setError(Gles.InvalidOperation);
    return;
  }
  const type: unknown = g.getFramebufferAttachmentParameter(
    g.READ_FRAMEBUFFER,
    g.COLOR_ATTACHMENT0,
    g.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE,
  );
  if (type !== g.RENDERBUFFER) {
    host.setError(Gles.InvalidOperation);
    return;
  }
  const name: unknown = g.getFramebufferAttachmentParameter(
    g.READ_FRAMEBUFFER,
    g.COLOR_ATTACHMENT0,
    g.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
  );
  const renderbuffer = name instanceof WebGLRenderbuffer ? name : null;
  const previous = objectParameter(g, g.RENDERBUFFER_BINDING, WebGLRenderbuffer);
  const scissor = g.isEnabled(g.SCISSOR_TEST);
  try {
    g.bindRenderbuffer(g.RENDERBUFFER, renderbuffer);
    const width = numeric(g.getRenderbufferParameter(g.RENDERBUFFER, g.RENDERBUFFER_WIDTH));
    const height = numeric(g.getRenderbufferParameter(g.RENDERBUFFER, g.RENDERBUFFER_HEIGHT));
    if (scissor) g.disable(g.SCISSOR_TEST);
    g.blitFramebuffer(0, 0, width, height, 0, 0, width, height, g.COLOR_BUFFER_BIT, g.NEAREST);
  } finally {
    if (scissor) g.enable(g.SCISSOR_TEST);
    g.bindRenderbuffer(g.RENDERBUFFER, previous);
  }
}

/** Framebuffer attachments, renderbuffer storage and the multisample resolve. */
export function installFramebuffers(host: GlesContext): void {
  host.bind("FramebufferRenderbuffer", (a) => {
    const [target, attachment, renderbufferTarget, handle] = words4(a);
    host
      .gl()
      .framebufferRenderbuffer(
        target,
        attachment,
        renderbufferTarget,
        host.handles.getRenderbuffer(handle),
      );
  });
  host.bind("FramebufferTexture2D", (a) => {
    const [target, attachment, textureTarget, handle, level] = words5(a);
    host
      .gl()
      .framebufferTexture2D(
        target,
        attachment,
        textureTarget,
        host.handles.getTexture(handle),
        level,
      );
  });
  host.bind("RenderbufferStorage", (a) => {
    const [target, format, width, height] = words4(a);
    host.gl().renderbufferStorage(target, format, width, height);
    host.renderbufferStorage(width, height);
  });
  host.bind("RenderbufferStorageMultisampleAPPLE", (a) => {
    const gl = host.gl();
    if (!hasMultisample(gl)) {
      host.setError(Gles.InvalidOperation);
      return;
    }
    const [target, samples, format, width, height] = words5(a);
    gl.renderbufferStorageMultisample(target, samples, format, width, height);
    host.renderbufferStorage(width, height, samples);
  });
  host.bind("ResolveMultisampleFramebufferAPPLE", () => resolveMultisample(host));
  host.bind("GetRenderbufferParameteriv", (a) => {
    const [target, name, pointer] = words3(a);
    write32(host.cpu, pointer, numeric(host.gl().getRenderbufferParameter(target, name)));
  });
  host.bind("GetFramebufferAttachmentParameteriv", (a) => {
    const [target, attachment, name, pointer] = words4(a);
    const result: unknown = host.gl().getFramebufferAttachmentParameter(target, attachment, name);
    write32(
      host.cpu,
      pointer,
      typeof result === "object" ? host.handles.any(result) : numeric(result),
    );
  });
}
