import { Axis, Inset, type ScrollViews } from "./state";
const THICKNESS = 3;
const WHITE_INDICATOR = 2;
const GUTTER = 3;
const MINIMUM_THUMB = 18;
export function drawScrollIndicators(
  views: ScrollViews,
  self: number,
  context: CanvasRenderingContext2D,
): void {
  const state = views.get(self);
  if (!state.indicatorVisible) return;
  const [x, y, w, h] = views.host.view(self).bounds,
    [minimum, maximum] = views.range(self),
    offset = views.offset(self);
  context.fillStyle =
    state.indicatorStyle === WHITE_INDICATOR ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.45)";
  const draw = (axis: 0 | 1, start: number, track: number, content: number, vertical: boolean) => {
    const length = Math.min(
        track,
        Math.max(MINIMUM_THUMB, (track * track) / Math.max(track, content)),
      ),
      range = maximum[axis] - minimum[axis];
    if (!(range > 0 && track > 0)) return;
    const fraction = Math.max(0, Math.min(1, (offset[axis] - minimum[axis]) / range));
    if (vertical)
      context.fillRect(
        x + w - state.indicatorInsets[Inset.Right] - GUTTER - THICKNESS,
        start + fraction * (track - length),
        THICKNESS,
        length,
      );
    else
      context.fillRect(
        start + fraction * (track - length),
        y + h - state.indicatorInsets[Inset.Bottom] - GUTTER - THICKNESS,
        length,
        THICKNESS,
      );
  };
  if (state.verticalIndicator)
    draw(
      Axis.Y,
      y + state.indicatorInsets[Inset.Top] + GUTTER,
      h - state.indicatorInsets[Inset.Top] - state.indicatorInsets[Inset.Bottom] - GUTTER - GUTTER,
      state.size[Axis.Y],
      true,
    );
  if (state.horizontalIndicator)
    draw(
      Axis.X,
      x + state.indicatorInsets[Inset.Left] + GUTTER,
      w - state.indicatorInsets[Inset.Left] - state.indicatorInsets[Inset.Right] - GUTTER - GUTTER,
      state.size[Axis.X],
      false,
    );
}
