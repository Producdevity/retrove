import { expect, test } from "vite-plus/test";
import { MovieLoading, MovieLoadState } from "./movie-loading";
import { MovieNotification } from "./movie-playback";
test("movie loading queues native state and preload notifications from actual media readiness", () => {
  const loading = new MovieLoading();
  loading.update(1);
  expect(loading.state).toBe(MovieLoadState.Unknown);
  expect(loading.take()).toEqual([]);
  loading.update(2);
  expect(loading.state).toBe(MovieLoadState.Playable);
  expect(loading.take()).toEqual([
    MovieNotification.LoadStateChanged,
    MovieNotification.ContentPreloaded,
  ]);
  loading.update(4);
  expect(loading.state).toBe(3);
  expect(loading.take()).toEqual([MovieNotification.LoadStateChanged]);
  loading.update(4);
  expect(loading.take()).toEqual([]);
  loading.update(2, true);
  expect(loading.state).toBe(5);
  expect(loading.take()).toEqual([MovieNotification.LoadStateChanged]);
  loading.update(3);
  expect(loading.state).toBe(1);
  loading.reset();
  expect(loading.state).toBe(0);
  expect(loading.take()).toEqual([]);
  loading.update(4);
  expect(loading.take()).toEqual([
    MovieNotification.LoadStateChanged,
    MovieNotification.ContentPreloaded,
  ]);
});
