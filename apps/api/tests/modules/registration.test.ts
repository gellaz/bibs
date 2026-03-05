import { describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ── Mock service layer ────────────────────────────────────────────────────────

const now = new Date("2025-01-01T00:00:00.000Z");

const mockCustomerUser = {
	id: "user-cust-1",
	name: "Mario Rossi",
	email: "mario@example.it",
	role: "customer",
	emailVerified: false,
	image: null,
	createdAt: now,
	updatedAt: now,
	banned: null,
	banReason: null,
	banExpires: null,
};

const mockSellerUser = {
	id: "user-sell-1",
	name: "Luca Venditore",
	email: "luca@example.it",
	role: "seller",
	emailVerified: false,
	image: null,
	createdAt: now,
	updatedAt: now,
	banned: null,
	banReason: null,
	banExpires: null,
};

const mockRegisterCustomer = mock(
	async (_body: { email: string; password: string }) => ({
		user: mockCustomerUser,
		profile: {
			id: "prof-1",
			userId: mockCustomerUser.id,
			points: 0,
			createdAt: now,
		},
		token: "mock-token-customer",
	}),
);

const mockRegisterSeller = mock(
	async (_body: { email: string; password: string }) => ({
		user: mockSellerUser,
		profile: {
			id: "prof-2",
			userId: mockSellerUser.id,
			onboardingStatus: "pending_email",
			createdAt: now,
		},
		token: "mock-token-seller",
	}),
);

const mockSignIn = mock(async (_body: { email: string; password: string }) => ({
	user: mockCustomerUser,
	profiles: {
		customer: {
			id: "prof-1",
			userId: mockCustomerUser.id,
			points: 0,
			createdAt: now,
		},
		seller: null,
	},
	organization: null,
	token: "mock-token-signin",
}));

mock.module("@/modules/registration/services", () => ({
	registerCustomer: mockRegisterCustomer,
	registerSeller: mockRegisterSeller,
	signIn: mockSignIn,
}));

// ── Test app ──────────────────────────────────────────────────────────────────

import { ServiceError } from "@/lib/errors";
import { registration } from "@/modules/registration";
import { errorHandler } from "@/plugins/error-handler";
import { requestId } from "@/plugins/request-id";

// Provides store.pino, which logixlysia normally injects in production.
const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(requestId)
	.use(registration);

// ── Helpers ───────────────────────────────────────────────────────────────────

function post(path: string, body: unknown) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

async function json(res: Response) {
	return res.json() as Promise<Record<string, unknown>>;
}

// ── Tests: POST /register/customer ───────────────────────────────────────────

describe("POST /register/customer — validation", () => {
	it("rejects invalid email format → 422", async () => {
		const res = await post("/register/customer", {
			email: "not-an-email",
			password: "password123",
		});
		expect(res.status).toBe(422);
	});

	it("rejects password shorter than 8 chars → 422", async () => {
		const res = await post("/register/customer", {
			email: "mario@example.it",
			password: "short",
		});
		expect(res.status).toBe(422);
	});

	it("rejects password longer than 128 chars → 422", async () => {
		const res = await post("/register/customer", {
			email: "mario@example.it",
			password: "x".repeat(129),
		});
		expect(res.status).toBe(422);
	});

	it("rejects missing body fields → 422", async () => {
		const res = await post("/register/customer", {});
		expect(res.status).toBe(422);
	});
});

describe("POST /register/customer — success", () => {
	it("returns 200 with success:true on valid input", async () => {
		mockRegisterCustomer.mockClear();
		const res = await post("/register/customer", {
			email: "mario@example.it",
			password: "password123",
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.success).toBe(true);
		expect((body.data as Record<string, unknown>).user).toBeDefined();
	});

	it("calls registerCustomer service once with the request body", async () => {
		mockRegisterCustomer.mockClear();
		await post("/register/customer", {
			email: "mario@example.it",
			password: "password123",
		});
		expect(mockRegisterCustomer).toHaveBeenCalledTimes(1);
	});

	it("response contains user email and token", async () => {
		const res = await post("/register/customer", {
			email: "mario@example.it",
			password: "password123",
		});
		const body = await json(res);
		const data = body.data as Record<string, unknown>;
		expect((data.user as Record<string, unknown>).email).toBe(
			"mario@example.it",
		);
		expect(data.token).toBe("mock-token-customer");
	});
});

describe("POST /register/customer — service errors", () => {
	it("returns 409 when service throws ServiceError(409)", async () => {
		mockRegisterCustomer.mockImplementationOnce(async () => {
			throw new ServiceError(409, "Email già registrata");
		});
		const res = await post("/register/customer", {
			email: "mario@example.it",
			password: "password123",
		});
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("CONFLICT");
	});

	it("returns 500 when service throws an unexpected error", async () => {
		mockRegisterCustomer.mockImplementationOnce(async () => {
			throw new Error("Database connection lost");
		});
		const res = await post("/register/customer", {
			email: "mario@example.it",
			password: "password123",
		});
		expect(res.status).toBe(500);
		const body = await json(res);
		expect(body.error).toBe("INTERNAL_ERROR");
	});
});

// ── Tests: POST /register/seller ─────────────────────────────────────────────

describe("POST /register/seller — validation", () => {
	it("rejects invalid email format → 422", async () => {
		const res = await post("/register/seller", {
			email: "not-email",
			password: "password123",
		});
		expect(res.status).toBe(422);
	});

	it("rejects password shorter than 8 chars → 422", async () => {
		const res = await post("/register/seller", {
			email: "luca@example.it",
			password: "123",
		});
		expect(res.status).toBe(422);
	});
});

describe("POST /register/seller — success", () => {
	it("returns 200 with success:true on valid input", async () => {
		const res = await post("/register/seller", {
			email: "luca@example.it",
			password: "password123",
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.success).toBe(true);
		const data = body.data as Record<string, unknown>;
		expect((data.user as Record<string, unknown>).role).toBe("seller");
	});

	it("returns 409 when service throws ServiceError(409)", async () => {
		mockRegisterSeller.mockImplementationOnce(async () => {
			throw new ServiceError(409, "Email già registrata");
		});
		const res = await post("/register/seller", {
			email: "luca@example.it",
			password: "password123",
		});
		expect(res.status).toBe(409);
	});
});

// ── Tests: POST /register/sign-in ────────────────────────────────────────────

describe("POST /register/sign-in — validation", () => {
	it("rejects invalid email format → 422", async () => {
		const res = await post("/register/sign-in", {
			email: "not-an-email",
			password: "password123",
		});
		expect(res.status).toBe(422);
	});

	it("rejects missing password → 422", async () => {
		const res = await post("/register/sign-in", { email: "mario@example.it" });
		expect(res.status).toBe(422);
	});
});

describe("POST /register/sign-in — success", () => {
	it("returns 200 with user and profiles on valid credentials", async () => {
		const res = await post("/register/sign-in", {
			email: "mario@example.it",
			password: "password123",
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.success).toBe(true);
		const data = body.data as Record<string, unknown>;
		expect(data.user).toBeDefined();
		expect(data.profiles).toBeDefined();
	});

	it("returns 401 when service throws ServiceError(401)", async () => {
		mockSignIn.mockImplementationOnce(async () => {
			throw new ServiceError(401, "Invalid credentials");
		});
		const res = await post("/register/sign-in", {
			email: "mario@example.it",
			password: "wrong",
		});
		expect(res.status).toBe(401);
		const body = await json(res);
		expect(body.error).toBe("UNAUTHORIZED");
	});
});
