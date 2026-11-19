const MAGIC = [...new TextEncoder().encode("\0asm"), 1, 0, 0, 0];
const Section = { Type: 1, Function: 3, Code: 10 } as const;
const Op = {
  FunctionType: 0x60,
  I32: 0x7f,
  LocalGet: 0x20,
  I32Const: 0x41,
  I32Add: 0x6a,
  I32Mul: 0x6c,
  I32Xor: 0x73,
  End: 0x0b,
} as const;
const LEB_BITS = 7;
const LEB_MASK = 0x7f;
const LEB_MORE = 0x80;
const OPERATIONS_PER_FUNCTION = 64;
const CONSTANT = 0x2a;
const ALTERNATION = 2;
/** One `(i32) -> i32` type: form, one parameter, one result. */
const TYPE_BODY = [1, Op.FunctionType, 1, Op.I32, 1, Op.I32];

function leb(value: number): number[] {
  const bytes: number[] = [];
  let rest = value >>> 0;
  do {
    const byte = rest & LEB_MASK;
    rest >>>= LEB_BITS;
    bytes.push(rest ? byte | LEB_MORE : byte);
  } while (rest);
  return bytes;
}
function functionBody(): Uint8Array {
  const code: number[] = [0, Op.LocalGet, 0];
  for (let index = 0; index < OPERATIONS_PER_FUNCTION; index++)
    code.push(Op.I32Const, CONSTANT, index % ALTERNATION ? Op.I32Add : Op.I32Xor);
  code.push(Op.LocalGet, 0, Op.I32Mul, Op.End);
  return new Uint8Array([...leb(code.length), ...code]);
}

/** A module of `count` arithmetic functions, sized like translated game code. */
export function syntheticModule(count: number): Uint8Array<ArrayBuffer> {
  const types = [Section.Type, TYPE_BODY.length, ...TYPE_BODY];
  const countBytes = leb(count),
    body = functionBody();
  const functionsSize = countBytes.length + count,
    codeSize = countBytes.length + count * body.length;
  const functionsHeader = [Section.Function, ...leb(functionsSize), ...countBytes],
    codeHeader = [Section.Code, ...leb(codeSize), ...countBytes];
  const bytes = new Uint8Array(
    MAGIC.length +
      types.length +
      functionsHeader.length +
      count +
      codeHeader.length +
      count * body.length,
  );
  let at = 0;
  const put = (part: ArrayLike<number>): void => {
    bytes.set(part, at);
    at += part.length;
  };
  put(MAGIC);
  put(types);
  put(functionsHeader);
  at += count;
  put(codeHeader);
  for (let index = 0; index < count; index++) put(body);
  return bytes;
}
