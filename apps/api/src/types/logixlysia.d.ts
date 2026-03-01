import type { LogixlysiaStore } from "logixlysia";

declare module "elysia" {
	interface SingletonBase {
		store: LogixlysiaStore;
	}
}
