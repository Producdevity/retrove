export interface MerkleHash {
  readonly blockLen: number;
  readonly outputLen: number;
  readonly buffer: Uint8Array;
  length: number;
  pos: number;
  update(data: Uint8Array): this;
  digest(): Uint8Array;
  get(): number[];
  set(...words: number[]): void;
}
export interface Hasher {
  readonly blockLen: number;
  readonly outputLen: number;
  create(): MerkleHash;
}
