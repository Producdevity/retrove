import { Argument, type FoundationHost } from "../objc/host";

export interface GameKitHost extends FoundationHost {
  /** Calls a guest block with its arguments after the block pointer. */
  callBlock(block: number, args: number[]): Promise<unknown>;
  copyBlock(block: number): Promise<number>;
  releaseBlock(block: number): Promise<void>;
  later(task: () => Promise<void>): void;
  /** An autoreleased NSError. */
  error(code: number, domain: string): number;
}
const DOMAIN = "GKErrorDomain";
/** GKErrorCode values: no Game Center account is ever signed in. */
const GKError = { Cancelled: 2, NotAuthenticated: 6 } as const;

/**
 * Game Center as on a device whose player never signs in: sign-in reports cancellation and
 * every network request reports that no player is authenticated, on the next run loop turn.
 */
export function installOfflineGameKit(host: GameKitHost): void {
  const player = host.hostClass("GKLocalPlayer", "NSObject");
  for (const name of ["GKScore", "GKAchievement", "GKLeaderboard", "GKAchievementDescription"])
    host.hostClass(name, "NSObject");
  let local = 0;
  const reply = async (block: number, code: number, leading: number[]): Promise<void> => {
    if (!block) return;
    const copy = await host.copyBlock(block);
    host.later(async () => {
      try {
        await host.callBlock(copy, [...leading, host.error(code, DOMAIN)]);
      } finally {
        await host.releaseBlock(copy);
      }
    });
  };
  host.method("GKLocalPlayer", true, "localPlayer", () => {
    local ||= host.alloc(player);
    return local;
  });
  for (const [name, value] of [
    ["isAuthenticated", 0],
    ["isUnderage", 0],
    ["playerID", 0],
    ["alias", 0],
    ["displayName", 0],
    ["friends", 0],
  ] as const)
    host.method("GKLocalPlayer", false, name, () => value);
  host.method("GKLocalPlayer", false, "authenticateWithCompletionHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.Cancelled, []),
  );
  host.method("GKLocalPlayer", false, "setAuthenticateHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.Cancelled, [0]),
  );
  host.method("GKLocalPlayer", false, "loadFriendsWithCompletionHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.NotAuthenticated, [0]),
  );
  for (const [cls, initializers] of [
    ["GKScore", ["initWithCategory:", "initWithLeaderboardIdentifier:"]],
    ["GKAchievement", ["initWithIdentifier:"]],
    ["GKLeaderboard", ["initWithPlayerIDs:"]],
  ] as const) {
    host.method(cls, false, "init", (self) => self);
    for (const initializer of initializers) host.method(cls, false, initializer, (self) => self);
  }
  for (const [cls, setters] of [
    [
      "GKScore",
      [
        "setValue:",
        "setContext:",
        "setCategory:",
        "setLeaderboardIdentifier:",
        "setShouldSetDefaultLeaderboard:",
      ],
    ],
    ["GKAchievement", ["setPercentComplete:", "setShowsCompletionBanner:"]],
    [
      "GKLeaderboard",
      ["setCategory:", "setTimeScope:", "setPlayerScope:", "setRange:", "setIdentifier:"],
    ],
  ] as const)
    for (const setter of setters) host.method(cls, false, setter, () => undefined);
  installRequests(host, reply);
}

type Reply = (block: number, code: number, leading: number[]) => Promise<void>;
function installRequests(host: GameKitHost, reply: Reply): void {
  host.method("GKScore", false, "reportScoreWithCompletionHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.NotAuthenticated, []),
  );
  host.method("GKScore", true, "reportScores:withCompletionHandler:", (_self, args) =>
    reply(args(Argument.Second), GKError.NotAuthenticated, []),
  );
  host.method("GKAchievement", false, "reportAchievementWithCompletionHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.NotAuthenticated, []),
  );
  host.method("GKAchievement", true, "loadAchievementsWithCompletionHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.NotAuthenticated, [0]),
  );
  host.method("GKAchievement", true, "resetAchievementsWithCompletionHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.NotAuthenticated, []),
  );
  host.method(
    "GKAchievementDescription",
    true,
    "loadAchievementDescriptionsWithCompletionHandler:",
    (_self, args) => reply(args(Argument.First), GKError.NotAuthenticated, [0]),
  );
  host.method("GKLeaderboard", false, "loadScoresWithCompletionHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.NotAuthenticated, [0]),
  );
  host.method("GKLeaderboard", true, "loadCategoriesWithCompletionHandler:", (_self, args) =>
    reply(args(Argument.First), GKError.NotAuthenticated, [0, 0]),
  );
}
