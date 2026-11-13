import { expect, test, vi } from "vite-plus/test";
import { MoviePlayback } from "./movie-playback";
class Visibility extends EventTarget {
  hidden = false;
  show(visible: boolean): void {
    this.hidden = !visible;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
class Video extends EventTarget {
  paused = true;
  ended = false;
  readonly play = vi.fn(() => {
    if (this.paused) {
      this.paused = false;
      queueMicrotask(() => this.dispatchEvent(new Event("play")));
    }
    return Promise.resolve();
  });
  readonly pause = vi.fn(() => {
    if (!this.paused) {
      this.paused = true;
      queueMicrotask(() => this.dispatchEvent(new Event("pause")));
    }
  });
}
function fixture() {
  const visibility = new Visibility(),
    video = new Video();
  const events = { needsResume: vi.fn(), failed: vi.fn() };
  return { visibility, video, events, playback: new MoviePlayback(video, visibility, events) };
}
test("backgrounded movies resume without resuming an explicitly paused movie", async () => {
  const { visibility, video, playback } = fixture();
  playback.play();
  await Promise.resolve();
  visibility.show(false);
  expect(video.paused).toBe(true);
  visibility.show(true);
  await Promise.resolve();
  expect(video.paused).toBe(false);
  visibility.show(false);
  playback.pause();
  await Promise.resolve();
  visibility.show(true);
  expect(video.paused).toBe(true);
  expect(video.play).toHaveBeenCalledTimes(2);
  playback.close();
});
test("native controls can pause a movie without it restarting after a visibility change", async () => {
  const { visibility, video, playback } = fixture();
  playback.play();
  await Promise.resolve();
  video.pause();
  await Promise.resolve();
  visibility.show(false);
  visibility.show(true);
  expect(video.play).toHaveBeenCalledTimes(1);
  playback.close();
});
test("a movie requested in the background waits until visible", async () => {
  const { visibility, video, playback } = fixture();
  visibility.show(false);
  playback.play();
  expect(video.play).not.toHaveBeenCalled();
  visibility.show(true);
  expect(video.play).toHaveBeenCalledTimes(1);
  playback.close();
  visibility.show(false);
  visibility.show(true);
  expect(video.play).toHaveBeenCalledTimes(1);
});
test("blocked playback offers a user action and stale failures do not end the movie", async () => {
  const { visibility, video, playback, events } = fixture();
  video.play.mockRejectedValueOnce(new DOMException("Gesture required", "NotAllowedError"));
  playback.play();
  await Promise.resolve();
  expect(events.needsResume).toHaveBeenLastCalledWith(true);
  let fail = (_error: Error) => {};
  video.play.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  playback.play();
  visibility.show(false);
  fail(new Error("Superseded play request"));
  await Promise.resolve();
  expect(events.failed).not.toHaveBeenCalled();
  visibility.show(true);
  await Promise.resolve();
  expect(video.paused).toBe(false);
  playback.close();
});

test("a delayed play event cannot undo an explicit pause", async () => {
  const { visibility, video, playback } = fixture();
  playback.play();
  playback.pause();
  await Promise.resolve();
  visibility.show(false);
  visibility.show(true);
  expect(video.paused).toBe(true);
  expect(video.play).toHaveBeenCalledTimes(1);
  playback.close();
});

test("native playback and explicit pause clear the playback action", async () => {
  const { video, playback, events } = fixture();
  video.play.mockRejectedValueOnce(new DOMException("Gesture required", "NotAllowedError"));
  playback.play();
  await Promise.resolve();
  expect(events.needsResume).toHaveBeenLastCalledWith(true);
  await video.play();
  expect(events.needsResume).toHaveBeenLastCalledWith(false);
  playback.pause();
  expect(events.needsResume).toHaveBeenLastCalledWith(false);
  playback.close();
});
