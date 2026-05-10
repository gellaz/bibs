import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import {
	employeeInvitation,
	employeeInvitationStores,
} from "@/db/schemas/employee-invitation";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { auth } from "@/lib/auth";
import { firstNames, lastNames, pick } from "./utils";

// ── Designated sellers ────────────────────────────────────

/** 8 multi-store sellers (also receive extra stores via seedExtraStores). */
const MULTI_STORE_IDXS = [0, 7, 14, 21, 28, 35, 42, 49] as const;

/** 14 single-store sellers that get a small team (1–2 employees). */
const SINGLE_TEAM_IDXS = [
	2, 5, 9, 12, 16, 19, 23, 26, 30, 33, 37, 40, 44, 47,
] as const;

/** Multi-store sellers that get 4 employees (rank-even in MULTI_STORE_IDXS). */
const MULTI_4_EMP_IDXS = [0, 14, 28, 42] as const;
/** Multi-store sellers that get 2 employees (rank-odd). */
const MULTI_2_EMP_IDXS = [7, 21, 35, 49] as const;

/** Single-team sellers with 2 employees (first 7). */
const SINGLE_2_EMP_IDXS = [2, 5, 9, 12, 16, 19, 23] as const;
/** Single-team sellers with 1 employee (last 7). */
const SINGLE_1_EMP_IDXS = [26, 30, 33, 37, 40, 44, 47] as const;

interface Assignment {
	/** "all" → emp assigned to every store of the seller; "single" → only stores[idx]. */
	type: "all" | "single";
	storeIdx?: number;
}

interface ScheduleEntry {
	empIdx: number; // 0..44 → employee${empIdx+1}@test.com
	sellerIdx: number; // original idx in seedSellers
	assignment: Assignment;
}

function buildSchedule(): ScheduleEntry[] {
	const out: ScheduleEntry[] = [];
	let empIdx = 0;

	// 7 seller × 2 employees → 14 emp, all on the (only) store
	for (const sellerIdx of SINGLE_2_EMP_IDXS) {
		for (let e = 0; e < 2; e++) {
			out.push({ empIdx, sellerIdx, assignment: { type: "all" } });
			empIdx++;
		}
	}
	// 7 seller × 1 employee → 7 emp on the (only) store
	for (const sellerIdx of SINGLE_1_EMP_IDXS) {
		out.push({ empIdx, sellerIdx, assignment: { type: "all" } });
		empIdx++;
	}
	// 4 seller × 4 employees (these have 3 stores total): 1 emp per store + 1 across all
	for (const sellerIdx of MULTI_4_EMP_IDXS) {
		for (let e = 0; e < 4; e++) {
			const assignment: Assignment =
				e < 3 ? { type: "single", storeIdx: e } : { type: "all" };
			out.push({ empIdx, sellerIdx, assignment });
			empIdx++;
		}
	}
	// 4 seller × 2 employees (these have 2 stores total): 1 on store[0] + 1 across all
	for (const sellerIdx of MULTI_2_EMP_IDXS) {
		out.push({
			empIdx,
			sellerIdx,
			assignment: { type: "single", storeIdx: 0 },
		});
		empIdx++;
		out.push({ empIdx, sellerIdx, assignment: { type: "all" } });
		empIdx++;
	}

	return out; // 14 + 7 + 16 + 8 = 45
}

export async function seedTeam() {
	const employeeCanary = await db.query.user.findFirst({
		where: eq(user.email, "employee1@test.com"),
	});
	const employeeCanaryExists = !!employeeCanary;

	const inviteCanary = await db.query.employeeInvitation.findFirst({
		where: eq(employeeInvitation.invitationToken, "inv-test-1"),
	});
	const inviteCanaryExists = !!inviteCanary;

	if (employeeCanaryExists && inviteCanaryExists) {
		console.log("  ⏭ Team already seeded, skipping");
		return;
	}

	// ── Resolve sellerProfileId + first stores for designated sellers ─
	const designatedSellerEmails = [...MULTI_STORE_IDXS, ...SINGLE_TEAM_IDXS].map(
		(idx) => `seller${idx + 1}@test.com`,
	);

	const sellerRows = await db
		.select({
			email: user.email,
			sellerProfileId: sellerProfile.id,
		})
		.from(sellerProfile)
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.where(inArray(user.email, designatedSellerEmails));

	if (sellerRows.length === 0) {
		console.log("  ⏭ No designated sellers found, skipping team");
		return;
	}

	const sellerProfileIdByIdx = new Map<number, string>();
	for (const r of sellerRows) {
		const m = r.email.match(/^seller(\d+)@test\.com$/);
		if (!m) continue;
		const idx = Number.parseInt(m[1], 10) - 1;
		sellerProfileIdByIdx.set(idx, r.sellerProfileId);
	}

	const sellerProfileIds = Array.from(sellerProfileIdByIdx.values());
	const storeRows = await db
		.select({
			id: store.id,
			sellerProfileId: store.sellerProfileId,
		})
		.from(store)
		.where(inArray(store.sellerProfileId, sellerProfileIds))
		.orderBy(asc(store.createdAt), asc(store.id));

	const storesBySeller = new Map<string, string[]>();
	for (const s of storeRows) {
		const arr = storesBySeller.get(s.sellerProfileId) ?? [];
		arr.push(s.id);
		storesBySeller.set(s.sellerProfileId, arr);
	}

	// ── Phase 1: create employee users (sequential — password hashing) ─
	if (!employeeCanaryExists) {
		const totalEmployees = 45;
		console.log(`  👥 Seeding ${totalEmployees} employee users...`);
		const createdUserIds: string[] = [];
		for (let i = 0; i < totalEmployees; i++) {
			const firstName = pick(firstNames, i, 1, 11);
			const lastName = pick(lastNames, i, 3, 19);
			const email = `employee${i + 1}@test.com`;
			try {
				const { user: u } = await auth.api.signUpEmail({
					body: {
						name: `${firstName} ${lastName}`,
						email,
						password: "password123",
					},
				});
				createdUserIds.push(u.id);
			} catch {
				console.error(`     ✗ Failed: ${email}`);
			}
			if ((i + 1) % 15 === 0) {
				console.log(`     ... ${i + 1}/${totalEmployees} users`);
			}
		}

		if (createdUserIds.length > 0) {
			await db
				.update(user)
				.set({ role: "employee", emailVerified: true })
				.where(inArray(user.id, createdUserIds));
		}

		// Build storeEmployee + storeEmployeeStores
		const schedule = buildSchedule();
		const userIdByEmpIdx = new Map<number, string>();
		// createdUserIds was populated in the same order as we iterated i = 0..44
		for (let i = 0; i < createdUserIds.length; i++) {
			userIdByEmpIdx.set(i, createdUserIds[i]);
		}

		const storeEmployeeRows: Array<{
			sellerProfileId: string;
			userId: string;
			empIdx: number;
			assignment: Assignment;
			storeIds: string[];
		}> = [];

		for (const entry of schedule) {
			const userId = userIdByEmpIdx.get(entry.empIdx);
			const sellerProfileId = sellerProfileIdByIdx.get(entry.sellerIdx);
			if (!userId || !sellerProfileId) continue;
			const sellerStores = storesBySeller.get(sellerProfileId) ?? [];
			if (sellerStores.length === 0) continue;
			const storeIds =
				entry.assignment.type === "all"
					? sellerStores
					: [sellerStores[entry.assignment.storeIdx ?? 0] ?? sellerStores[0]];
			storeEmployeeRows.push({
				sellerProfileId,
				userId,
				empIdx: entry.empIdx,
				assignment: entry.assignment,
				storeIds,
			});
		}

		if (storeEmployeeRows.length > 0) {
			const inserted = await db
				.insert(storeEmployee)
				.values(
					storeEmployeeRows.map((r) => ({
						sellerProfileId: r.sellerProfileId,
						userId: r.userId,
					})),
				)
				.returning({ id: storeEmployee.id, userId: storeEmployee.userId });

			const storeEmployeeIdByUserId = new Map(
				inserted.map((r) => [r.userId, r.id]),
			);

			const linkRows: Array<{ storeEmployeeId: string; storeId: string }> = [];
			for (const r of storeEmployeeRows) {
				const seId = storeEmployeeIdByUserId.get(r.userId);
				if (!seId) continue;
				for (const storeId of r.storeIds) {
					linkRows.push({ storeEmployeeId: seId, storeId });
				}
			}

			if (linkRows.length > 0) {
				await db.insert(storeEmployeeStores).values(linkRows);
			}

			console.log(
				`  ✓ ${inserted.length} store employees seeded (${linkRows.length} store assignments)`,
			);
		}
	} else {
		console.log("  ⏭ Employees already present, skipping employee phase");
	}

	// ── Phase 2: pending invitations (8 — one per multi-store seller) ─
	if (!inviteCanaryExists) {
		const invitationInputs = MULTI_STORE_IDXS.map((sellerIdx, rank) => {
			const sellerProfileId = sellerProfileIdByIdx.get(sellerIdx);
			if (!sellerProfileId) return null;
			const stores = storesBySeller.get(sellerProfileId) ?? [];
			if (stores.length === 0) return null;
			return {
				sellerProfileId,
				email: `pending-invite-${rank + 1}@test.com`,
				invitationToken: `inv-test-${rank + 1}`,
				status: "pending" as const,
				expiresAt: new Date("2099-12-31T23:59:59Z"),
				firstStoreId: stores[0],
			};
		}).filter((r): r is NonNullable<typeof r> => r !== null);

		if (invitationInputs.length > 0) {
			const inserted = await db
				.insert(employeeInvitation)
				.values(invitationInputs.map(({ firstStoreId: _, ...row }) => row))
				.returning({
					id: employeeInvitation.id,
					token: employeeInvitation.invitationToken,
				});

			const invitationIdByToken = new Map(inserted.map((r) => [r.token, r.id]));

			const inviteStoreRows = invitationInputs
				.map((r) => {
					const id = invitationIdByToken.get(r.invitationToken);
					if (!id) return null;
					return { invitationId: id, storeId: r.firstStoreId };
				})
				.filter(
					(r): r is { invitationId: string; storeId: string } => r !== null,
				);

			if (inviteStoreRows.length > 0) {
				await db.insert(employeeInvitationStores).values(inviteStoreRows);
			}

			console.log(
				`  ✓ ${inserted.length} pending invitations seeded (${inviteStoreRows.length} store assignments)`,
			);
		}
	} else {
		console.log("  ⏭ Invitations already present, skipping invite phase");
	}
}
