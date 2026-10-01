import { Alert, AlertDescription, AlertTitle } from "~/components/alert";
import { Button } from "~/components/button";
import { cn } from "~/lib/utils";

export type PendingVerificationBannerLabels = {
	title: string;
	body: (email: string) => string;
	resendCta: string;
	resendCooldown: (secondsRemaining: number) => string;
	forgotPassword: string;
	useOtherEmail: string;
};

export type PendingVerificationBannerProps = {
	email: string;
	/** Seconds remaining before the resend button is re-enabled. 0 = enabled. */
	secondsRemaining: number;
	onResend: () => void | Promise<void>;
	onForgotPassword?: () => void;
	onUseOtherEmail?: () => void;
	labels: PendingVerificationBannerLabels;
	/** Shows spinner / disables the resend button while a resend call is in flight. */
	resending?: boolean;
	className?: string;
};

export function PendingVerificationBanner({
	email,
	secondsRemaining,
	onResend,
	onForgotPassword,
	onUseOtherEmail,
	labels,
	resending = false,
	className,
}: PendingVerificationBannerProps) {
	const cooldownActive = secondsRemaining > 0;
	const resendDisabled = cooldownActive || resending;

	return (
		<Alert
			className={cn("mt-4 flex flex-col gap-3", className)}
			data-testid="pending-verification-banner"
		>
			<AlertTitle>{labels.title}</AlertTitle>
			<AlertDescription>{labels.body(email)}</AlertDescription>
			<div className="flex flex-col gap-2 pt-1">
				<Button
					type="button"
					onClick={() => {
						if (!resendDisabled) void onResend();
					}}
					disabled={resendDisabled}
					className="w-full"
				>
					{cooldownActive
						? labels.resendCooldown(secondsRemaining)
						: labels.resendCta}
				</Button>
				<div className="flex flex-col gap-1 text-center text-sm">
					{onForgotPassword && (
						<Button
							variant="link"
							type="button"
							onClick={onForgotPassword}
							className="h-auto p-0"
						>
							{labels.forgotPassword}
						</Button>
					)}
					{onUseOtherEmail && (
						<Button
							variant="link"
							type="button"
							onClick={onUseOtherEmail}
							className="h-auto p-0"
						>
							{labels.useOtherEmail}
						</Button>
					)}
				</div>
			</div>
		</Alert>
	);
}
