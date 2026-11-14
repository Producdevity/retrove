import { expect, test } from "vite-plus/test";
import { UserDefaults } from "./user-defaults";

test("saved and global values precede registration without losing false or zero", () => {
  const defaults = new UserDefaults({ sound: false, level: 0 }, { language: "en" });
  defaults.register({ sound: true, level: 1, language: "fr", theme: "silver" });
  expect(defaults.representation()).toEqual({
    sound: false,
    level: 0,
    language: "en",
    theme: "silver",
  });
  defaults.set("sound", undefined);
  expect(defaults.get("sound")).toBe(true);
  expect(defaults.persistent()).toEqual({ level: 0 });
});
test("registration merges but does not persist or leak between launches", () => {
  const defaults = new UserDefaults();
  defaults.register({ sound: true, theme: "silver" });
  defaults.register({ theme: "black" });
  defaults.set("level", 3);
  expect(defaults.representation()).toEqual({ sound: true, theme: "black", level: 3 });
  const restored = new UserDefaults(JSON.parse(JSON.stringify(defaults.persistent())));
  expect(restored.representation()).toEqual({ level: 3 });
});
test("registration copies property values and rejects invalid dictionaries atomically", () => {
  const values = { themes: ["silver"], options: { sound: true } };
  const defaults = new UserDefaults();
  defaults.register(values);
  values.themes.push("black");
  values.options.sound = false;
  expect(defaults.get("themes")).toEqual(["silver"]);
  expect(defaults.get("options")).toEqual({ sound: true });
  expect(() => defaults.register({ good: 1, invalid: undefined })).toThrow();
  expect(defaults.get("good")).toBeUndefined();
  expect(() => defaults.set("invalid", Infinity)).toThrow();
});
test("preference names do not resolve inherited properties", () => {
  const defaults = new UserDefaults(JSON.parse('{"__proto__":"saved"}'));
  expect(defaults.get("__proto__")).toBe("saved");
  expect(defaults.get("constructor")).toBeUndefined();
});
