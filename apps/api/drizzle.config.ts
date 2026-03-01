import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./src/db/migrations",
	schema: "./src/db/schemas",
	dialect: "postgresql",
	extensionsFilters: ["postgis"],
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
});
