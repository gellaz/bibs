import { OnboardingStoreBody } from "@bibs/api/schemas";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import {
	Dropzone,
	DropzoneContent,
	DropzoneEmptyState,
} from "@bibs/ui/components/dropzone";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import {
	useCreateStore,
	useGoBack,
	useSkipStore,
} from "@/hooks/use-onboarding";

type StoreFormData = Static<typeof OnboardingStoreBody>;
const compiledSchema = TypeCompiler.Compile(OnboardingStoreBody);

const MAX_STORE_IMAGES = 8;

export const Route = createFileRoute("/_authenticated/onboarding/store")({
	component: StorePage,
});

function StorePage() {
	const navigate = useNavigate();
	const mutation = useCreateStore();
	const skipMutation = useSkipStore();
	const goBackMutation = useGoBack();
	const [apiError, setApiError] = useState("");
	const [images, setImages] = useState<File[]>([]);

	const {
		register,
		handleSubmit,
		control,
		watch,
		formState: { errors, isSubmitting },
	} = useForm<StoreFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: { useCompanyAddress: false },
	});

	const useCompanyAddress = watch("useCompanyAddress");

	const handleDrop = useCallback(
		(acceptedFiles: File[]) => {
			const remaining = MAX_STORE_IMAGES - images.length;
			setImages((prev) => [...prev, ...acceptedFiles.slice(0, remaining)]);
		},
		[images.length],
	);

	const handleRemoveImage = useCallback((index: number) => {
		setImages((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const onSubmit: SubmitHandler<StoreFormData> = async (data) => {
		setApiError("");
		try {
			await mutation.mutateAsync({
				...data,
				images: images.length > 0 ? images : undefined,
			});
			void navigate({ to: "/onboarding/team" });
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
					<FieldLabel htmlFor="name" required>
						Nome del negozio
					</FieldLabel>
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
							<FieldLabel htmlFor="addressLine1" required>
								Indirizzo negozio
							</FieldLabel>
							<Input
								id="addressLine1"
								placeholder="Via Roma 1"
								{...register("addressLine1")}
							/>
							<FieldError errors={[errors.addressLine1]} />
						</Field>

						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<Field data-invalid={!!errors.city}>
								<FieldLabel htmlFor="city" required>
									Città
								</FieldLabel>
								<Input id="city" placeholder="Roma" {...register("city")} />
								<FieldError errors={[errors.city]} />
							</Field>

							<Field data-invalid={!!errors.province}>
								<FieldLabel htmlFor="province" required>
									Provincia
								</FieldLabel>
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
							<FieldLabel htmlFor="zipCode" required>
								CAP
							</FieldLabel>
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

				<div className="space-y-2">
					<Label>
						Foto del negozio
						{images.length > 0 && (
							<span className="ml-1 text-xs font-normal text-muted-foreground">
								({images.length}/{MAX_STORE_IMAGES})
							</span>
						)}
					</Label>
					<Dropzone
						src={images.length > 0 ? images : undefined}
						onDrop={handleDrop}
						maxFiles={MAX_STORE_IMAGES}
						maxSize={5 * 1024 * 1024}
						accept={{ "image/*": [".png", ".jpg", ".jpeg", ".webp"] }}
					>
						<DropzoneContent />
						<DropzoneEmptyState />
					</Dropzone>
					{images.length > 0 && (
						<div className="flex flex-wrap gap-2">
							{images.map((file, index) => (
								<div key={file.name + index} className="group relative">
									<img
										src={URL.createObjectURL(file)}
										alt=""
										className="size-20 rounded-md border object-cover"
									/>
									<button
										type="button"
										onClick={() => handleRemoveImage(index)}
										className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-destructive text-white shadow-sm ring-2 ring-background group-hover:flex"
									>
										<XIcon className="size-3" />
									</button>
								</div>
							))}
						</div>
					)}
				</div>

				<div className="mt-2 flex flex-col gap-2 sm:flex-row-reverse">
					<Button
						type="submit"
						disabled={isSubmitting || skipMutation.isPending}
						className="flex-1"
					>
						{isSubmitting ? "Creazione negozio..." : "Continua"}
					</Button>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								type="button"
								variant="outline"
								disabled={
									isSubmitting ||
									skipMutation.isPending ||
									goBackMutation.isPending
								}
								className="flex-1"
							>
								{goBackMutation.isPending ? "Attendere..." : "Indietro"}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Tornare indietro?</AlertDialogTitle>
								<AlertDialogDescription>
									I dati aziendali inseriti verranno eliminati e dovrai
									reinserirli.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Annulla</AlertDialogCancel>
								<AlertDialogAction
									onClick={async () => {
										try {
											await goBackMutation.mutateAsync(undefined);
											void navigate({ to: "/onboarding/company" });
										} catch (err) {
											setApiError(
												err instanceof Error ? err.message : "Errore",
											);
										}
									}}
								>
									Conferma
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>

				<Button
					type="button"
					variant="ghost"
					disabled={
						isSubmitting || skipMutation.isPending || goBackMutation.isPending
					}
					className="w-full"
					onClick={async () => {
						setApiError("");
						try {
							await skipMutation.mutateAsync(undefined);
							void navigate({ to: "/onboarding/team" });
						} catch (err) {
							setApiError(
								err instanceof Error
									? err.message
									: "Errore durante il salvataggio",
							);
						}
					}}
				>
					{skipMutation.isPending ? "Salto in corso..." : "Salta, lo farò dopo"}
				</Button>
			</form>
		</OnboardingLayout>
	);
}
