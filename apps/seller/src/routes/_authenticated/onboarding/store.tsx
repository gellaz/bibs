import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import { type StoreFormData, storeSchema } from "@/features/onboarding/schemas";
import { useCreateStore } from "@/hooks/use-onboarding";

export const Route = createFileRoute("/_authenticated/onboarding/store")({
	component: StorePage,
});

function StorePage() {
	const navigate = useNavigate();
	const mutation = useCreateStore();
	const [apiError, setApiError] = useState("");

	const {
		register,
		handleSubmit,
		control,
		watch,
		formState: { errors, isSubmitting },
	} = useForm<StoreFormData>({
		resolver: zodResolver(storeSchema),
		defaultValues: { useCompanyAddress: false },
	});

	const useCompanyAddress = watch("useCompanyAddress");

	const onSubmit: SubmitHandler<StoreFormData> = async (data) => {
		setApiError("");
		try {
			await mutation.mutateAsync(data);
			void navigate({ to: "/onboarding/payment" });
		} catch (err) {
			setApiError(
				err instanceof Error ? err.message : "Errore durante il salvataggio",
			);
		}
	};

	return (
		<OnboardingLayout
			currentStatus="pending_store"
			title="Il tuo negozio"
			description="Crea il tuo primo punto vendita"
		>
			<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
					</div>
				)}

				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="name">Nome del negozio</FieldLabel>
					<Input
						id="name"
						placeholder="La Bottega di Mario"
						autoFocus
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field data-invalid={!!errors.description}>
					<FieldLabel htmlFor="description">Descrizione (opzionale)</FieldLabel>
					<Input
						id="description"
						placeholder="Prodotti artigianali dal 1990"
						{...register("description")}
					/>
					<FieldError errors={[errors.description]} />
				</Field>

				<div className="flex items-center gap-2">
					<Controller
						control={control}
						name="useCompanyAddress"
						render={({ field }) => (
							<Checkbox
								id="useCompanyAddress"
								checked={field.value ?? false}
								onCheckedChange={field.onChange}
							/>
						)}
					/>
					<label htmlFor="useCompanyAddress" className="text-sm cursor-pointer">
						Usa lo stesso indirizzo della sede legale
					</label>
				</div>

				{!useCompanyAddress && (
					<>
						<Field data-invalid={!!errors.addressLine1}>
							<FieldLabel htmlFor="addressLine1">Indirizzo negozio</FieldLabel>
							<Input
								id="addressLine1"
								placeholder="Via Roma 1"
								{...register("addressLine1")}
							/>
							<FieldError errors={[errors.addressLine1]} />
						</Field>

						<div className="grid grid-cols-2 gap-4">
							<Field data-invalid={!!errors.city}>
								<FieldLabel htmlFor="city">Città</FieldLabel>
								<Input id="city" placeholder="Roma" {...register("city")} />
								<FieldError errors={[errors.city]} />
							</Field>

							<Field data-invalid={!!errors.province}>
								<FieldLabel htmlFor="province">Provincia</FieldLabel>
								<Input
									id="province"
									placeholder="RM"
									maxLength={2}
									{...register("province")}
								/>
								<FieldError errors={[errors.province]} />
							</Field>
						</div>

						<Field data-invalid={!!errors.zipCode}>
							<FieldLabel htmlFor="zipCode">CAP</FieldLabel>
							<Input
								id="zipCode"
								placeholder="00100"
								maxLength={5}
								{...register("zipCode")}
							/>
							<FieldError errors={[errors.zipCode]} />
						</Field>
					</>
				)}

				<Button type="submit" disabled={isSubmitting} className="w-full mt-2">
					{isSubmitting ? "Creazione negozio..." : "Continua"}
				</Button>
			</form>
		</OnboardingLayout>
	);
}
