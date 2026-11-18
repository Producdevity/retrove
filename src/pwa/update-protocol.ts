export const UpdateMessage = {
  Apply: "retrove:apply-update",
  Applied: "retrove:update-applied",
  Failed: "retrove:update-failed",
} as const;
export const WORKER_PATH = "/sw.js";
export const SHELL_CACHE_PREFIX = "retrove.shell:";
export const BUILD_ID = String(import.meta.env.VITE_RETROVE_REVISION);
