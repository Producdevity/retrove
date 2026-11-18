import { expect, test, vi } from "vite-plus/test";
import { Keychain, type KeychainAttributes } from "./keychain";
import { SecurityKey as Key, SecurityValue, SecurityStatus } from "./constants";
function fixture(initial: unknown = []) {
  let saved: unknown = structuredClone(initial);
  const write = vi.fn((items: readonly KeychainAttributes[]) => {
    saved = structuredClone(items);
    return Promise.resolve(true);
  });
  const storage = { read: () => Promise.resolve(structuredClone(saved)), write };
  return {
    store: new Keychain(storage),
    reopen: () => new Keychain(storage),
    write,
    saved: () => structuredClone(saved),
  };
}
const query = {
  [Key.Class]: SecurityValue.GenericPassword,
  [Key.Service]: "game",
  [Key.Account]: "player",
};
const item = { ...query, [Key.Data]: Uint8Array.of(1, 2, 3), [Key.Generic]: Uint8Array.of(4) };
test("generic-password data survives reopen and queries return independent byte buffers", async () => {
  const x = fixture();
  expect(await x.store.query(query)).toEqual([]);
  await x.store.add(item);
  expect(await x.reopen().query(query)).toEqual([item]);
  const first = (await x.store.query(query))[0]?.[Key.Data];
  if (!(first instanceof Uint8Array)) throw new Error("Missing stored data");
  first[0] = 99;
  expect(await x.store.query(query)).toEqual([item]);
  expect(await fixture().store.query(query)).toEqual([]);
});
test("generic metadata participates in matching but does not bypass account and service uniqueness", async () => {
  const x = fixture();
  await x.store.add(item);
  expect(await x.store.query({ ...query, [Key.Generic]: Uint8Array.of(9) })).toEqual([]);
  await expect(x.store.add({ ...item, [Key.Generic]: Uint8Array.of(9) })).rejects.toMatchObject({
    status: SecurityStatus.Duplicate,
  });
  expect(x.saved()).toEqual([item]);
});
test("updates change matching items, preserve others and reject conflicting identities atomically", async () => {
  const x = fixture();
  await x.store.add(item);
  await x.store.add({ ...item, [Key.Account]: "other" });
  await x.store.update(query, { [Key.Data]: Uint8Array.of(5) });
  expect((await x.store.query(query))[0]?.[Key.Data]).toEqual(Uint8Array.of(5));
  await expect(x.store.update(query, { [Key.Account]: "other" })).rejects.toMatchObject({
    status: SecurityStatus.Duplicate,
  });
  expect(await x.store.query({ ...query, [Key.Account]: "other" })).toEqual([
    { ...item, [Key.Account]: "other" },
  ]);
  await expect(x.store.update({ ...query, [Key.Account]: "missing" }, {})).rejects.toMatchObject({
    status: SecurityStatus.NotFound,
  });
});
test("deletion persists, missing deletions fail and failed writes keep the previous contents", async () => {
  const x = fixture();
  await x.store.add(item);
  x.write.mockResolvedValueOnce(false);
  await expect(x.store.delete(query)).rejects.toMatchObject({ status: SecurityStatus.IO });
  expect(await x.store.query(query)).toEqual([item]);
  await x.store.delete(query);
  expect(await x.reopen().query(query)).toEqual([]);
  await expect(x.store.delete(query)).rejects.toMatchObject({ status: SecurityStatus.NotFound });
});
test("concurrent guest mutations serialize without losing items and errors do not poison later operations", async () => {
  const x = fixture();
  const results = await Promise.allSettled([
    x.store.add(item),
    x.store.add(item),
    x.store.add({ ...item, [Key.Account]: "other" }),
  ]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  expect(await x.store.query({ [Key.Class]: SecurityValue.GenericPassword })).toHaveLength(2);
});
test("corrupt keychain storage fails explicitly and is never silently cleared", async () => {
  const x = fixture([{ ...query, [Key.Data]: "not bytes" }]);
  await expect(x.store.query(query)).rejects.toMatchObject({ status: SecurityStatus.Decode });
  expect(x.write).not.toHaveBeenCalled();
});
test("internet passwords are keyed by server, domain and port, with numeric attributes", async () => {
  const x = fixture();
  const login = {
    [Key.Class]: SecurityValue.InternetPassword,
    [Key.Server]: "api.openfeint.com",
    [Key.SecurityDomain]: "openfeint.com",
    [Key.AuthenticationType]: SecurityValue.AuthenticationDefault,
    [Key.Account]: "Gyrotate.oauth_token_access",
    [Key.Port]: 443,
  };
  await x.store.add({ ...login, [Key.Data]: Uint8Array.of(9) });
  await expect(x.store.add({ ...login, [Key.Data]: Uint8Array.of(8) })).rejects.toMatchObject({
    status: SecurityStatus.Duplicate,
  });
  await x.store.add({ ...login, [Key.Port]: 80 });
  expect(await x.reopen().query({ ...login, [Key.Port]: 443 })).toEqual([
    { ...login, [Key.Data]: Uint8Array.of(9) },
  ]);
  await expect(x.store.add({ ...login, [Key.Port]: "443" })).rejects.toMatchObject({
    status: SecurityStatus.Decode,
  });
});
