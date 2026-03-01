import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { auth } from "@/lib/auth";

const testUsers = [
	{
		name: "Admin User",
		email: "admin@test.com",
		password: "password123",
		role: "admin",
	},
	{
		name: "Customer User",
		email: "customer@test.com",
		password: "password123",
		role: "customer",
	},
	{
		name: "Seller User",
		email: "seller@test.com",
		password: "password123",
		role: "seller",
		vatStatus: "verified",
		vatNumber: "IT12345678901",
	},
	{
		name: "Seller Pending",
		email: "seller-pending@test.com",
		password: "password123",
		role: "seller",
		vatStatus: "pending",
		vatNumber: "IT12345678902",
	},
	{
		name: "Seller Rejected",
		email: "seller-rejected@test.com",
		password: "password123",
		role: "seller",
		vatStatus: "rejected",
		vatNumber: "IT12345678903",
	},
] as const;

export async function seed() {
	console.log("🌱 Seeding database...");

	for (const testUser of testUsers) {
		const existing = await db.query.user.findFirst({
			where: eq(user.email, testUser.email),
		});

		if (existing) {
			console.log(`  ⏭ ${testUser.email} already exists, skipping`);
			continue;
		}

		const { user: created } = await auth.api.signUpEmail({
			body: {
				name: testUser.name,
				email: testUser.email,
				password: testUser.password,
			},
		});

		await db
			.update(user)
			.set({ role: testUser.role })
			.where(eq(user.id, created.id));

		if (testUser.role === "customer") {
			await db.insert(customerProfile).values({ userId: created.id });
		}

		if (testUser.role === "seller") {
			const vatStatus =
				"vatStatus" in testUser ? testUser.vatStatus : "pending";
			const vatNumber =
				"vatNumber" in testUser ? testUser.vatNumber : "IT00000000000";
			const [sp] = await db
				.insert(sellerProfile)
				.values({
					userId: created.id,
					vatNumber,
					vatStatus,
				})
				.returning();

			if (vatStatus === "verified") {
				await db.insert(store).values({
					sellerProfileId: sp.id,
					name: "Test Store",
					description: "A test store for development",
					addressLine1: "Via Roma 1",
					city: "Milano",
					zipCode: "20121",
					province: "MI",
				});
			}
		}

		console.log(`  ✓ ${testUser.email} (${testUser.role})`);
	}

	console.log("🌱 Seed complete");
}
