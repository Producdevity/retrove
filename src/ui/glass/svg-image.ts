const images = new Map<string, HTMLImageElement>();

/** An inline SVG icon as an image, with `currentColor` resolved, for drawing on a canvas. */
export function svgImage(
  svg: SVGSVGElement,
  color: string,
  loaded: () => void,
): HTMLImageElement | undefined {
  const clone = svg.cloneNode(true);
  if (!(clone instanceof SVGSVGElement)) return undefined;
  const style = getComputedStyle(svg);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("color", color);
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  for (const property of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"])
    clone.setAttribute(property, style.getPropertyValue(property));
  const source = new XMLSerializer().serializeToString(clone);
  const cached = images.get(source);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : undefined;
  const image = new Image();
  image.addEventListener("load", loaded, { once: true });
  image.src = `data:image/svg+xml,${encodeURIComponent(source)}`;
  images.set(source, image);
  return undefined;
}
