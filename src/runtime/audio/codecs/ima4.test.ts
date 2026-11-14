import { expect, test } from "vite-plus/test";
import { decodeIMA4, IMA4Decoder } from "./ima4";
const references = [
  {
    channels: 1,
    compressed:
      "000000254a6f94b9de03284d7297bce1062b50759abfe4092e53789dc2e70c31567b204813385d82a7ccf1163b6085aacff4193e6388add2f71c41668bb0d5fa1f44698ea058264b7095badf04294e7398bde2072c51769bc0e50a2f54799ec3e80d32577ca1",
    reference: {
      channels: 1,
      frames: 192,
      samples:
        "AAAAAAAAAAAAAIA5AADgOQAAgDkAABA6AAAAuAAAjDoAACI7AAD8OgAAvDoAAMA5AAC8ugAAibsAANS6AACougAA0LoAAGC5AABCuwAAwDkAACo7AAAOPACAsjwAgIQ8AABIOgCAYbwAgAW8AAD5vACAFDwAgGw8AACivAAAIDsAANQ7AOA/PQAg2T0AmGU+ACAPPgDwvz0A8Oy9AHimvgBwpL0AHAK/AOYuvwBUIb8AAIC/ALQSvwBA87wAID8/AK4kPwD+fz8A+L++APg/vwD4Ob4AAIC/APhfPwACQL8AAIC/AAJgvwC6CL8AsEE+AP5/PwD+fz8AEAA+AP5/PwCA4T4AvgM/APz7PgCcIj8AmNw+AOg6PwDkbT8AoGQ/AP5/PwCqJT8A0I49AAAhvwDAsb4AAIC/APofPwD2fz8AMFE+AHJtPwD+fz8A/n8/AP5/PwAAYD8ADJ0+AOhWvgAAgL8AAIC/AOD/PQAAgL8AAIC/ALgovwAAgL8AGAC+AKQrPwD+fz8AAGA/AOhCPwAYwL4AAIC/AAzdvgAAgL8A+F8/AACAvwAAgL8ABCC/AHiRvgBSJT8A/n8/AP5/PwAQAD4AADs8APDqPQDwCr8ADMs+AHR6vwAAgL8AAIC/AACAvwAEIL8AsMs+AP5/PwACID8A/n8/APwfvwD6P78A+l8/AP5/PwBQUT4A/n8/AP5/PwD+fz8A/n8/AAIgPwCAaD0Aniq/AACAvwAAgL8A4P89AOh/PgBwur0A5Nk+AKRLvwCwqD4A/n8/AP5/PwAAYD8AuAg/ADwavwAAgL8ADN2+AACAvwD4Xz8A9n8/AMC8vAAWGj8AXnE/AP5/PwD+fz8A/n8/ABAAPgAQXb4AkOa9ADp1vwCklT4AAIC/AACAvwDoYr8AAIC/AAjAvgDYJT8A/n8/AAIgPwD+fz8A/B+/APh/vwA4Ub4AAIC/AACAvwAAgL8AAIC/AAJgvwAQnb4APNU+AP5/PwD+fz8A8P+9AP5/PwD+fz8ACN0+",
    },
  },
  {
    channels: 2,
    compressed:
      "000000254a6f94b9de03284d7297bce1062b50759abfe4092e53789dc2e70c31567b000153789dc2e70c31567ba0c5ea0f34597ea3c8ed12375c81a6cbf0153a5f84a9ce204813385d82a7ccf1163b6085aacff4193e6388add2f71c41668bb0d5fa1f44698e2048668bb0d5fa1f44698eb3d8fd22476c91b6db00254a6f94b9de03284d7297bce1a058264b7095badf04294e7398bde2072c51769bc0e50a2f54799ec3e80d32577ca1a048799ec3e80d32577ca1c6eb10355a7fa4c9ee13385d82a7ccf1163b6085aacff4",
    reference: {
      channels: 2,
      frames: 192,
      samples:
        "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",
    },
  },
];
test("IMA4 mono and stereo samples match native ExtAudioFileRead across packet headers", () => {
  for (const item of references) {
    const compressed = Uint8Array.from(Buffer.from(item.compressed, "hex"));
    const reference = Buffer.from(item.reference.samples, "base64");
    const actual = decodeIMA4(compressed, item.channels);
    expect(actual?.length).toBe(item.reference.frames * item.channels);
    expect(actual).not.toBeNull();
    if (!actual) throw new Error("IMA4 fixture failed to decode.");
    for (const [i, sample] of actual.entries()) expect(sample).toBe(reference.readFloatLE(i * 4));
  }
});
test("IMA4 rejects incomplete packet groups and invalid header indexes", () => {
  expect(decodeIMA4(new Uint8Array(35), 1)).toBeNull();
  expect(decodeIMA4(new Uint8Array(34), 2)).toBeNull();
  expect(decodeIMA4(new Uint8Array(34), 0)).toBeNull();
  const invalid = new Uint8Array(34);
  invalid[1] = 89;
  expect(decodeIMA4(invalid, 1)).toBeNull();
  expect(decodeIMA4(new Uint8Array(), 1)).toEqual(new Float32Array());
});

test("IMA4 preserves low predictor bits across compatible packet headers and streamed chunks", () => {
  const packet = new Uint8Array(34);
  packet[2] = 1;
  const next = new Uint8Array(34),
    all = new Uint8Array(68);
  all.set(packet);
  all.set(next, 34);
  const decoder = new IMA4Decoder(1);
  expect(decoder.decode(packet)?.[63]).toBe(1 / 32768);
  expect(decoder.decode(next)?.[0]).toBe(1 / 32768);
  expect(decodeIMA4(all, 1)?.[127]).toBe(1 / 32768);
  const invalid = new Uint8Array(34);
  invalid[1] = 89;
  expect(decoder.decode(invalid)).toBeNull();
  expect(decoder.decode(next)?.[0]).toBe(1 / 32768);
});
