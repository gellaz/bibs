import { Elysia } from "elysia";
import { locationsRoutes } from "./routes/locations";

export const locationsModule = new Elysia({ prefix: "/locations" }).use(
	locationsRoutes,
);
