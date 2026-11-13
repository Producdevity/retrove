import { expect, test, vi } from "vite-plus/test";
import { AudioVisibility } from "./audio-visibility";
class Visibility extends EventTarget {
  hidden = false;
  show(visible: boolean): void {
    this.hidden = !visible;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
class Audio extends EventTarget {
  state: AudioContextState = "running";
  readonly resume = vi.fn(() => {
    this.change("running");
    return Promise.resolve();
  });
  readonly suspend = vi.fn(() => {
    this.change("suspended");
    return Promise.resolve();
  });
  change(state: AudioContextState): void {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
test("hiding suspends audio, showing resumes it, and closing removes listeners", async () => {
  const source = new Visibility(),
    audio = new Audio(),
    required = vi.fn(),
    failed = vi.fn();
  const media = new AudioVisibility(audio, source, required, failed);
  source.show(false);
  await vi.waitFor(() => expect(audio.state).toBe("suspended"));
  expect(audio.suspend).toHaveBeenCalledTimes(1);
  source.show(true);
  await vi.waitFor(() => expect(audio.state).toBe("running"));
  expect(audio.resume).toHaveBeenCalledTimes(1);
  expect(required).toHaveBeenLastCalledWith(false);
  media.close();
  source.show(false);
  expect(audio.suspend).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
});
test("blocked automatic resume leaves the user action available and can recover", async () => {
  const source = new Visibility(),
    audio = new Audio(),
    required = vi.fn(),
    failed = vi.fn();
  const media = new AudioVisibility(audio, source, required, failed);
  const blocked = new DOMException("A gesture is required", "NotAllowedError");
  source.show(false);
  audio.resume.mockRejectedValueOnce(blocked);
  source.show(true);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(blocked));
  expect(required).toHaveBeenLastCalledWith(true);
  await media.resume();
  expect(required).toHaveBeenLastCalledWith(false);
  media.close();
});
test("a browser-suspended context offers resume without repeatedly retrying it", async () => {
  const source = new Visibility(),
    audio = new Audio(),
    required = vi.fn();
  const media = new AudioVisibility(audio, source, required, vi.fn());
  audio.change("suspended");
  expect(required).toHaveBeenLastCalledWith(true);
  expect(audio.resume).not.toHaveBeenCalled();
  await media.resume();
  expect(required).toHaveBeenLastCalledWith(false);
  media.close();
});
test("a delayed resume completing in the background is suspended again", async () => {
  const source = new Visibility(),
    audio = new Audio(),
    required = vi.fn();
  const media = new AudioVisibility(audio, source, required, vi.fn());
  let complete = () => {};
  audio.change("suspended");
  audio.resume.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = () => {
          audio.change("running");
          resolve();
        };
      }),
  );
  const resumed = media.resume();
  source.show(false);
  complete();
  await resumed;
  expect(audio.state).toBe("suspended");
  expect(audio.suspend).toHaveBeenCalledTimes(1);
  expect(required).toHaveBeenLastCalledWith(false);
  media.close();
});
