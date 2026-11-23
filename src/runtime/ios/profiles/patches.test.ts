import { expect, test } from "vite-plus/test";
import { createCPU } from "../../cpu/cpu";
import profile from "./bioshock.json";
import { patchExecutable } from "./patches";
test("executable patching verifies every word before changing a private copy", () => {
  const original = new Uint8Array(new Uint32Array([1, 2, 3]).buffer);
  const groups = [
    {
      name: "fixture",
      words: [
        { offset: 0, original: 1, replacement: 9 },
        { offset: 8, original: 3, replacement: 7 },
      ],
    },
  ];
  expect(new Uint32Array(patchExecutable(original, groups).buffer)).toEqual(
    Uint32Array.of(9, 2, 7),
  );
  expect(new Uint32Array(original.buffer)).toEqual(Uint32Array.of(1, 2, 3));
  for (const words of [
    [{ offset: 12, original: 0, replacement: 0 }],
    [{ offset: 2, original: 1, replacement: 0 }],
    [{ offset: 0, original: 99, replacement: 0 }],
    [
      { offset: 0, original: 1, replacement: 9 },
      { offset: 0, original: 1, replacement: 8 },
    ],
  ])
    expect(() => patchExecutable(original, [{ name: "invalid", words }])).toThrow();
  expect(new Uint32Array(original.buffer)).toEqual(Uint32Array.of(1, 2, 3));
});
test("BioShock canvas helpers use iOS point dimensions without changing pixel rendering", async () => {
  const cpu = await createCPU();
  const helperStart = 0x189bf74,
    helperEnd = 0x189bfd0,
    tabletFlag = 0x2490034,
    returnTo = 0x189bffc;
  cpu.map(0x189b000, 4096);
  cpu.map(0x2490000, 4096);
  try {
    for (const { words } of profile.groups)
      for (const word of words) {
        if (word.offset >= helperStart && word.offset < helperEnd)
          cpu.write(word.offset, new Uint8Array(Uint32Array.of(word.replacement).buffer));
      }
    for (const [flag, width, height] of [
      [0, 568, 320],
      [1, 1024, 768],
    ]) {
      if (flag === undefined || width === undefined || height === undefined)
        throw new Error("Invalid test tuple");
      cpu.write(tabletFlag, new Uint8Array(Uint32Array.of(flag).buffer));
      for (const [entry, expected] of [
        [helperStart, width],
        [0x189bf90, height],
      ]) {
        if (entry === undefined) throw new Error("Invalid test entry");
        cpu.setReg(14, returnTo);
        expect(cpu.run(entry, { until: returnTo, count: 50 }).reason).toBe("until");
        expect(cpu.getReg(0)).toBe(expected);
      }
      cpu.setReg(14, returnTo);
      expect(cpu.run(0x189bfac, { until: returnTo, count: 50 }).reason).toBe("until");
      expect([cpu.getReg(10), cpu.getReg(6)]).toEqual([width, height]);
    }
  } finally {
    cpu.close();
  }
});
