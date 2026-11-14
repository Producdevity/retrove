import { identity, MATRIX_ELEMENTS, multiply } from "./matrix";

export const MatrixMode = { ModelView: 0x1700, Projection: 0x1701, Texture: 0x1702 } as const;
export type MatrixMode = (typeof MatrixMode)[keyof typeof MatrixMode];
export const MatrixError = {
  InvalidEnum: 0x0500,
  InvalidValue: 0x0501,
  Overflow: 0x0503,
  Underflow: 0x0504,
} as const;
export const MODEL_VIEW_STACK_DEPTH = 16;
export const PROJECTION_STACK_DEPTH = 2;
export const TEXTURE_STACK_DEPTH = 2;
export const FIXED_TEXTURE_UNITS = 2;

class MatrixStack {
  private readonly saved: Float32Array[] = [];
  value = identity();
  constructor(readonly capacity: number) {}
  get depth(): number {
    return this.saved.length + 1;
  }
  push(): number {
    if (this.depth >= this.capacity) return MatrixError.Overflow;
    this.saved.push(this.value.slice());
    return 0;
  }
  pop(): number {
    const value = this.saved.pop();
    if (!value) return MatrixError.Underflow;
    this.value = value;
    return 0;
  }
}
export class MatrixState {
  readonly modelView = new MatrixStack(MODEL_VIEW_STACK_DEPTH);
  readonly projection = new MatrixStack(PROJECTION_STACK_DEPTH);
  private readonly textures = Array.from(
    { length: FIXED_TEXTURE_UNITS },
    () => new MatrixStack(TEXTURE_STACK_DEPTH),
  );
  mode: MatrixMode = MatrixMode.ModelView;
  textureUnit = 0;
  texture(unit: number): MatrixStack {
    const stack = this.textures[unit];
    if (!stack) throw new Error("Invalid fixed-function texture unit.");
    return stack;
  }
  get current(): MatrixStack {
    switch (this.mode) {
      case MatrixMode.ModelView:
        return this.modelView;
      case MatrixMode.Projection:
        return this.projection;
      case MatrixMode.Texture:
        return this.texture(this.textureUnit);
    }
  }
  select(mode: number): number {
    if (
      mode !== MatrixMode.ModelView &&
      mode !== MatrixMode.Projection &&
      mode !== MatrixMode.Texture
    )
      return MatrixError.InvalidEnum;
    this.mode = mode;
    return 0;
  }
  load(value: Float32Array): number {
    if (value.length !== MATRIX_ELEMENTS) return MatrixError.InvalidValue;
    this.current.value = value.slice();
    return 0;
  }
  multiply(value: Float32Array): number {
    if (value.length !== MATRIX_ELEMENTS) return MatrixError.InvalidValue;
    this.current.value = multiply(this.current.value, value);
    return 0;
  }
  push(): number {
    return this.current.push();
  }
  pop(): number {
    return this.current.pop();
  }
}
