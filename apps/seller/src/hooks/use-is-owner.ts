// apps/seller/src/hooks/use-is-owner.ts
import { authClient } from "@/lib/auth-client";

/**
 * True se l'utente loggato è il titolare (owner) del seller profile.
 * Owner: role === "seller" (legacy convention). Employee: role === "employee".
 */
export function useIsOwner(): boolean {
	const { data: session } = authClient.useSession();
	return session?.user.role === "seller";
}
