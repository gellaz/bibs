import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { storeEmployee } from "@/db/schemas/employee";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListEmployeesParams {
	sellerProfileId: string;
	page?: number;
	limit?: number;
}

export async function listEmployees(params: ListEmployeesParams) {
	const { sellerProfileId } = params;
	const { page, limit, offset } = parsePagination(params);

	const [data, [{ total }]] = await Promise.all([
		db.query.storeEmployee.findMany({
			where: eq(storeEmployee.sellerProfileId, sellerProfileId),
			with: { user: true },
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(storeEmployee)
			.where(eq(storeEmployee.sellerProfileId, sellerProfileId)),
	]);

	return { data, pagination: { page, limit, total } };
}

interface CreateEmployeeParams {
	sellerProfileId: string;
	email: string;
	password: string;
}

export async function createEmployee(params: CreateEmployeeParams) {
	const { sellerProfileId, email, password } = params;
	const name = email.split("@")[0];

	// Sign-up happens outside transaction (better-auth manages its own writes)
	const { user: newUser } = await auth.api.signUpEmail({
		body: { name, email, password },
	});

	// Role assignment + employee record in a single transaction
	return db.transaction(async (tx) => {
		await tx
			.update(user)
			.set({ role: "employee" })
			.where(eq(user.id, newUser.id));

		const [employee] = await tx
			.insert(storeEmployee)
			.values({ sellerProfileId, userId: newUser.id })
			.returning();

		return employee;
	});
}

interface EmployeeActionParams {
	employeeId: string;
	sellerProfileId: string;
}

export async function banEmployee(params: EmployeeActionParams) {
	const { employeeId, sellerProfileId } = params;

	const [updated] = await db
		.update(storeEmployee)
		.set({ status: "banned" })
		.where(
			and(
				eq(storeEmployee.id, employeeId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
			),
		)
		.returning();

	if (!updated) throw new ServiceError(404, "Employee not found");
	return updated;
}

export async function unbanEmployee(params: EmployeeActionParams) {
	const { employeeId, sellerProfileId } = params;

	const [updated] = await db
		.update(storeEmployee)
		.set({ status: "active" })
		.where(
			and(
				eq(storeEmployee.id, employeeId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
			),
		)
		.returning();

	if (!updated) throw new ServiceError(404, "Employee not found");
	return updated;
}

export async function removeEmployee(params: EmployeeActionParams) {
	const { employeeId, sellerProfileId } = params;

	const [updated] = await db
		.update(storeEmployee)
		.set({ status: "removed" })
		.where(
			and(
				eq(storeEmployee.id, employeeId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
			),
		)
		.returning();

	if (!updated) throw new ServiceError(404, "Employee not found");
	return updated;
}
