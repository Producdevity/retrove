import type { SaveStorage } from "../src/runtime/storage/save-storage";
export function writeSave(namespace: string, storage: SaveStorage): Promise<void>;
export function verifySave(namespace: string, storage: SaveStorage): Promise<void>;
export function isolated(namespace: string, storage: SaveStorage): Promise<void>;
