import { Elysia } from "elysia";
import { betterAuth } from "@/plugins/better-auth";
import { avatarRoutes } from "./routes/avatar";

export const meModule = new Elysia({ prefix: "/me" })
	.use(betterAuth)
	.use(avatarRoutes);
