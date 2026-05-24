import { PendingVerificationBanner } from "@bibs/ui/components/pending-verification-banner";
import { toast } from "@bibs/ui/components/sonner";
import { useCooldown } from "@bibs/ui/hooks/use-cooldown";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

type Props = {
	email: string;
	/** Epoch ms — momento in cui il backend ha rispedito il link. */
	resentAt: number;
	onUseOtherEmail: () => void;
};

const COOLDOWN_MS = 60_000;

export function PendingVerificationBannerConnected({
	email,
	resentAt,
	onUseOtherEmail,
}: Props) {
	const navigate = useNavigate();
	const [cooldownStartedAt, setCooldownStartedAt] = useState<number>(resentAt);
	const { secondsRemaining, ready } = useCooldown(
		cooldownStartedAt,
		COOLDOWN_MS,
	);
	const [resending, setResending] = useState(false);

	const onResend = async () => {
		if (!ready || resending) return;
		setResending(true);
		try {
			await authClient.sendVerificationEmail({
				email,
				callbackURL: `${window.location.origin}/login`,
			});
			setCooldownStartedAt(Date.now());
			toast.success(m.auth_register_pending_resent_toast());
		} catch {
			toast.error(m.auth_generic_error());
		} finally {
			setResending(false);
		}
	};

	const onForgotPassword = () => {
		// La route /forgot-password non esiste ancora (out of scope dello spec).
		// Il link punta al placeholder per quando la feature arriverà.
		void navigate({
			// biome-ignore lint/suspicious/noExplicitAny: route non ancora dichiarata
			to: "/forgot-password" as any,
			// biome-ignore lint/suspicious/noExplicitAny: search params di una route non dichiarata
			search: { email } as any,
		});
	};

	return (
		<PendingVerificationBanner
			email={email}
			secondsRemaining={ready ? 0 : secondsRemaining}
			onResend={onResend}
			onForgotPassword={onForgotPassword}
			onUseOtherEmail={onUseOtherEmail}
			resending={resending}
			labels={{
				title: m.auth_register_pending_title(),
				body: (e) => m.auth_register_pending_body({ email: e }),
				resendCta: m.auth_register_pending_resend_cta(),
				resendCooldown: (n) =>
					m.auth_register_pending_resend_cooldown({ seconds: String(n) }),
				forgotPassword: m.auth_register_pending_forgot_password(),
				useOtherEmail: m.auth_register_pending_use_other_email(),
			}}
		/>
	);
}
