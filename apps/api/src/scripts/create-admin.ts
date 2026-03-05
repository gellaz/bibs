/**
 * Create an admin user.
 *
 * Usage:
 *   bun run create-admin -- --email admin@example.com --password s3cret
 *
 * If --password is omitted, a random 24-char password is generated and printed.
 */

import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { auth } from "@/lib/auth";

const { values } = parseArgs({
	options: {
		email: { type: "string" },
		password: { type: "string" },
	},
	strict: true,
});

if (!values.email) {
	console.error(
		"Usage: bun run create-admin -- --email <email> [--password <pwd>]",
	);
	process.exit(1);
}

const email = values.email;
const name = email.split("@")[0];
const generated = !values.password;
const password =
	values.password ?? crypto.randomUUID().replace(/-/g, "").slice(0, 24);

// Check for existing user
const existing = await db.query.user.findFirst({
	where: eq(user.email, email),
});

if (existing) {
	if (existing.role === "admin") {
		console.log(`⏭ Admin ${email} already exists, nothing to do.`);
	} else {
		console.log(
			`⚠ User ${email} exists with role "${existing.role}". Promoting to admin...`,
		);
		await db
			.update(user)
			.set({ role: "admin" })
			.where(eq(user.id, existing.id));
		console.log(`✓ ${email} promoted to admin.`);
	}
} else {
	const { user: created } = await auth.api.signUpEmail({
		body: { name, email, password },
	});

	await db
		.update(user)
		.set({ role: "admin", emailVerified: true })
		.where(eq(user.id, created.id));

	console.log(`✓ Admin created: ${email}`);
	if (generated) {
		console.log(`  Password: ${password}`);
		console.log("  ⚠ Save this password — it won't be shown again.");
	}
}

process.exit(0);
