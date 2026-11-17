const NAMESPACE = "http://www.w3.org/2000/svg";
export const Icon = {
  More: ["M5.5 12h.01M12 12h.01M18.5 12h.01"],
  Share: ["M12 4v11M8 8l4-4 4 4M6 12v7h12v-7"],
  AddToHome: ["M5 5h14v14H5z", "M12 9v6M9 12h6"],
} as const;

/** An outline icon in Retrove's style: 24-unit grid, round caps, current colour. */
export function icon(paths: readonly string[], className = "icon"): SVGSVGElement {
  const svg = document.createElementNS(NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  for (const data of paths) {
    const path = document.createElementNS(NAMESPACE, "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}
