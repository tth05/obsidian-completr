import { afterAll } from "bun:test";
import { shutdownObsidian } from "./harness/obsidian.ts";

// One Obsidian instance is shared by all e2e test files of a run; kill it at the very end.
afterAll(shutdownObsidian);
