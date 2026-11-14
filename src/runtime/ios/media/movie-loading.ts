import { MovieNotification } from "./movie-playback";
export const MovieLoadState = { Unknown: 0, Playable: 1, PlaythroughOK: 2, Stalled: 4 } as const;
const MediaReadyState = { CurrentData: 2, FutureData: 3, EnoughData: 4 } as const;
export class MovieLoading {
  state: number = MovieLoadState.Unknown;
  private preloaded = false;
  private readonly notifications = new Set<string>();
  update(readyState: number, waiting = false): void {
    let value: number = MovieLoadState.Unknown;
    if (readyState >= MediaReadyState.CurrentData) value |= MovieLoadState.Playable;
    if (readyState >= MediaReadyState.EnoughData) value |= MovieLoadState.PlaythroughOK;
    if (waiting && readyState < MediaReadyState.FutureData) value |= MovieLoadState.Stalled;
    if (value !== this.state) {
      this.state = value;
      this.notifications.add(MovieNotification.LoadStateChanged);
    }
    if (!this.preloaded && value & MovieLoadState.Playable) {
      this.preloaded = true;
      this.notifications.add(MovieNotification.ContentPreloaded);
    }
  }
  take(): string[] {
    const values = [...this.notifications];
    this.notifications.clear();
    return values;
  }
  reset(): void {
    this.state = MovieLoadState.Unknown;
    this.preloaded = false;
    this.notifications.clear();
  }
}
