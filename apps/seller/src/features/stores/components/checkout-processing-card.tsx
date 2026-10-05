import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Spinner } from "@bibs/ui/components/spinner";
import { m } from "@/paraglide/messages";
import type { CheckoutProgress } from "../lib/checkout-progress";

/** Card della pagina di attesa dopo il pagamento del nuovo negozio. */
export function CheckoutProcessingCard({
	kind,
	onRetry,
	onBackToForm,
}: {
	kind: CheckoutProgress["kind"];
	onRetry: () => void;
	onBackToForm: () => void;
}) {
	return (
		<div className="mx-auto w-full max-w-md py-16">
			<Card>
				<CardHeader>
					<CardTitle>
						{kind === "failed"
							? m.store_processing_failed_title()
							: m.store_processing_title()}
					</CardTitle>
				</CardHeader>
				<CardContent
					className="flex flex-col items-center gap-4 py-8"
					aria-live="polite"
				>
					{kind === "timeout" ? (
						<>
							<p className="text-center text-sm text-muted-foreground">
								{m.store_processing_timeout()}
							</p>
							<Button type="button" variant="outline" onClick={onRetry}>
								{m.store_processing_retry()}
							</Button>
						</>
					) : kind === "failed" ? (
						<>
							<p className="text-center text-sm text-muted-foreground">
								{m.store_processing_failed_body()}
							</p>
							<Button type="button" variant="outline" onClick={onBackToForm}>
								{m.store_processing_failed_action()}
							</Button>
						</>
					) : (
						<>
							<Spinner />
							<p className="text-center text-sm text-muted-foreground">
								{m.store_processing_body()}
							</p>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
