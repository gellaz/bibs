import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Field, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useEffect, useState } from "react";

export interface CsvImportResult {
	created: number;
	skipped: number;
	failed: number;
	errors: Array<{ row: number; message: string }>;
}

interface CsvImportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	formatHint: string;
	onImport: (file: File) => Promise<CsvImportResult>;
	onSuccess?: () => void;
}

export function CsvImportDialog({
	open,
	onOpenChange,
	title,
	description,
	formatHint,
	onImport,
	onSuccess,
}: CsvImportDialogProps) {
	const [file, setFile] = useState<File | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [result, setResult] = useState<CsvImportResult | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		if (!open) {
			setFile(null);
			setSubmitting(false);
			setResult(null);
			setErrorMessage(null);
		}
	}, [open]);

	const handleSubmit = async () => {
		if (!file) return;
		setSubmitting(true);
		setErrorMessage(null);
		try {
			const data = await onImport(file);
			setResult(data);
			if (data.failed === 0) {
				onSuccess?.();
			} else if (data.created > 0 || data.skipped > 0) {
				// Partial success: still refresh the underlying list.
				onSuccess?.();
			}
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Errore durante l'import",
			);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{result ? (
					<div className="space-y-4 py-2">
						<div className="grid grid-cols-3 gap-3">
							<div className="bg-muted/50 rounded-lg border p-3">
								<div className="text-muted-foreground text-xs">Create</div>
								<div className="text-2xl font-semibold tabular-nums">
									{result.created}
								</div>
							</div>
							<div className="bg-muted/50 rounded-lg border p-3">
								<div className="text-muted-foreground text-xs">Saltate</div>
								<div className="text-2xl font-semibold tabular-nums">
									{result.skipped}
								</div>
							</div>
							<div className="bg-muted/50 rounded-lg border p-3">
								<div className="text-muted-foreground text-xs">Errori</div>
								<div className="text-2xl font-semibold tabular-nums">
									{result.failed}
								</div>
							</div>
						</div>

						{result.errors.length > 0 && (
							<div className="bg-card max-h-72 overflow-auto rounded-lg border">
								<Table>
									<TableHeader>
										<TableRow className="bg-muted/50 hover:bg-muted/50">
											<TableHead className="w-20 pl-4">Riga</TableHead>
											<TableHead>Errore</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{result.errors.map((err) => (
											<TableRow key={`${err.row}-${err.message}`}>
												<TableCell className="pl-4 font-mono text-sm">
													{err.row}
												</TableCell>
												<TableCell className="text-sm">{err.message}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				) : (
					<div className="space-y-4 py-2">
						<Field>
							<FieldLabel htmlFor="csv-file">File CSV</FieldLabel>
							<Input
								id="csv-file"
								type="file"
								accept=".csv,text/csv"
								onChange={(e) => setFile(e.target.files?.[0] ?? null)}
								disabled={submitting}
							/>
							<p className="text-muted-foreground text-xs">{formatHint}</p>
						</Field>

						{errorMessage && (
							<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-3">
								<p className="text-sm">{errorMessage}</p>
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					{result ? (
						<Button onClick={() => onOpenChange(false)}>Chiudi</Button>
					) : (
						<>
							<Button
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={submitting}
							>
								Annulla
							</Button>
							<Button onClick={handleSubmit} disabled={!file || submitting}>
								{submitting ? "Importazione..." : "Importa"}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
