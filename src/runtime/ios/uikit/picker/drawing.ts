import { PickerDefaults } from "./types";
import type { Pickers } from "./model";
const PickerStyle = {
  Background: "#f7f7f8",
  Text: "#171719",
  Line: "#b5b5bb",
  Indicator: "rgba(85,85,95,0.07)",
  Font: "20px system-ui",
  EdgeOpacity: 0.25,
} as const;
export async function drawPicker(
  pickers: Pickers,
  self: number,
  context: CanvasRenderingContext2D,
): Promise<void> {
  await pickers.load(self);
  const [x, y, width, height] = pickers.host.view(self).bounds,
    center = y + height * PickerDefaults.Half;
  context.save();
  try {
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.fillStyle = PickerStyle.Background;
    context.fillRect(x, y, width, height);
    context.font = PickerStyle.Font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    let left = pickers.left(self);
    for (const [index, component] of pickers.get(self).components.entries()) {
      const visible = Math.ceil((height * PickerDefaults.Half) / component.height),
        first = Math.max(0, component.selected - visible),
        last = Math.min(component.rows - 1, component.selected + visible);
      for (let row = first; row <= last; row++) {
        const offset = (row - component.selected) * component.height,
          title = await pickers.title(self, row, index);
        context.globalAlpha = Math.max(PickerStyle.EdgeOpacity, 1 - Math.abs(offset) / height);
        context.fillStyle = PickerStyle.Text;
        context.fillText(
          title,
          left + component.width * PickerDefaults.Half,
          center + offset,
          component.width,
        );
      }
      context.globalAlpha = 1;
      if (pickers.get(self).indicator) {
        const top = center - component.height * PickerDefaults.Half;
        context.fillStyle = PickerStyle.Indicator;
        context.fillRect(left, top, component.width, component.height);
        context.fillStyle = PickerStyle.Line;
        context.fillRect(left, top, component.width, 1);
        context.fillRect(left, top + component.height, component.width, 1);
      }
      left += component.width;
    }
  } finally {
    context.restore();
  }
}
