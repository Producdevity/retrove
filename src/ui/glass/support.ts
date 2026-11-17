const REDUCED_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Whether WebGL refraction should run. It is checked before the renderer is loaded, so a
 * browser that cannot or should not use it never downloads it. Reduced motion keeps the
 * static CSS material, because refraction moves with everything that scrolls under it.
 */
export function refractionAllowed(): boolean {
  if (matchMedia(REDUCED_TRANSPARENCY).matches || matchMedia(REDUCED_MOTION).matches) return false;
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) return false;
  probe.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}
