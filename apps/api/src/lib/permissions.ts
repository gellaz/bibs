import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

const statement = {
	...defaultStatements,
} as const;

export const ac = createAccessControl(statement);

export const adminRole = ac.newRole({
	...adminAc.statements,
});

export const customerRole = ac.newRole({
	user: [],
	session: [],
});

export const sellerRole = ac.newRole({
	user: [],
	session: [],
});

export const employeeRole = ac.newRole({
	user: [],
	session: [],
});
