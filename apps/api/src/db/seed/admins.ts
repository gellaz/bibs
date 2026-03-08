import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { auth } from "@/lib/auth";

const testAdmins = [
	{ email: "admin1@test.com", password: "password123" },
	{ email: "admin2@test.com", password: "password123" },
	{ email: "admin3@test.com", password: "password123" },
];

export async function seedAdmins() {
	for (const admin of testAdmins) {
		const existing = await db.query.user.findFirst({
			where: eq(user.email, admin.email),
		});

		if (existing) {
			console.log(`  ⏭ ${admin.email} already exists, skipping`);
			continue;
		}

		const name = admin.email.split("@")[0];
		const { user: created } = await auth.api.signUpEmail({
			body: { name, email: admin.email, password: admin.password },
		});

		await db
			.update(user)
			.set({ role: "admin", emailVerified: true })
			.where(eq(user.id, created.id));

		console.log(`  ✓ ${admin.email} (admin)`);
	}
}
