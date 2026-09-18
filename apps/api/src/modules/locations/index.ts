import { Elysia } from "elysia";
import { betterAuth } from "@/plugins/better-auth";
import { locationsRoutes } from "./routes/locations";

// `betterAuth` serve per il macro `auth: true` di `/geocode`. Le altre route
// del modulo restano pubbliche: nessun `.guard()` attorno a loro.
export const locationsModule = new Elysia({ prefix: "/locations" })
	.use(betterAuth)
	.use(locationsRoutes);
