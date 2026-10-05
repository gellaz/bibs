import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { MembershipStatusBadge } from "./membership-status-badge";
import { SellerRoleBadge } from "./seller-role-badge";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function text(node: React.ReactElement) {
	return renderToStaticMarkup(node)
		.replace(/<[^>]+>/g, "")
		.trim();
}

const STATUSES = ["active", "pending", "banned", "removed"] as const;

describe("MembershipStatusBadge", () => {
	it("labels each status in Italian", () => {
		overwriteGetLocale(() => "it");
		expect(
			STATUSES.map((s) => text(<MembershipStatusBadge status={s} />)),
		).toEqual(["Attivo", "In attesa", "Sospeso", "Rimosso"]);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(
			STATUSES.map((s) => text(<MembershipStatusBadge status={s} />)),
		).toEqual(["Active", "Pending", "Suspended", "Removed"]);
	});

	it("shows an unknown status as it is", () => {
		expect(text(<MembershipStatusBadge status="archived" />)).toBe("archived");
	});
});

describe("SellerRoleBadge", () => {
	it("labels owner and employee in both languages", () => {
		overwriteGetLocale(() => "it");
		expect(text(<SellerRoleBadge userRole="seller" />)).toBe("Titolare");
		expect(text(<SellerRoleBadge userRole="employee" />)).toBe("Dipendente");
		overwriteGetLocale(() => "en");
		expect(text(<SellerRoleBadge userRole="seller" />)).toBe("Owner");
		expect(text(<SellerRoleBadge userRole="employee" />)).toBe("Employee");
	});
});
