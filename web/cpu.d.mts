export interface GuestCPU {
  map(address: number, size: number, permissions?: number): void;
  protect(address: number, size: number, permissions: number): void;
  write(address: number, bytes: Uint8Array): void;
  read(address: number, size: number): Uint8Array;
  getReg(index: number): number;
  setReg(index: number, value: number): void;
  run(address: number, options?: { until?: number; count?: number }): {
    reason: "until" | "trap" | "budget";
    pc: number;
  };
  trap(address: number, handler: (cpu: GuestCPU, address: number) => void): () => void;
  close(): void;
}
export function createCPU(): Promise<GuestCPU>;
