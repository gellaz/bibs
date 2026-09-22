import { createFileRoute } from "@tanstack/react-router";
import { CalendarOff, Clock, HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { TileImage } from "@/components/tile";

/**
 * ROUTE TEMPORANEA — da cancellare prima della PR.
 *
 * Serve a decidere come il customer mostra un negozio che non ha mai dichiarato
 * gli orari. Non importa nulla dai componenti di produzione: li replica, così
 * la decisione si prende senza aver già modificato niente.
 *
 * Aprila su http://localhost:3001/preview-open-status
 */
export const Route = createFileRoute("/preview-open-status")({
	component: PreviewPage,
});

type Kind = "open" | "closed" | "unknown";

interface Sample {
	kind: Kind;
	name: string;
	category: string;
	city: string;
	province: string;
}

const SAMPLES: Sample[] = [
	{
		kind: "open",
		name: "Panificio Tamburini",
		category: "Panetteria",
		city: "Bologna",
		province: "BO",
	},
	{
		kind: "closed",
		name: "Ferramenta Zanardi",
		category: "Ferramenta",
		city: "Casalecchio di Reno",
		province: "BO",
	},
	{
		kind: "unknown",
		name: "Cartoleria Il Quadrifoglio",
		category: "Cartoleria",
		city: "San Lazzaro di Savena",
		province: "BO",
	},
	{
		kind: "unknown",
		name: "Erboristeria Le Radici",
		category: "Erboristeria",
		city: "Casteldebole",
		province: "BO",
	},
];

/** Le etichette che oggi il customer sa produrre, per i due stati noti. */
const KNOWN_LABEL: Record<"open" | "closed", string> = {
	open: "Aperto · chiude alle 19:30",
	closed: "Chiuso · apre domani alle 08:30",
};

// ---------------------------------------------------------------------------
// Le quattro varianti. Ognuna decide SOLO cosa fare del caso `unknown`:
// `open` e `closed` restano identici a main, così il confronto è pulito.
// ---------------------------------------------------------------------------

type Variant = {
	id: string;
	title: string;
	note: string;
	/** null = la riga non viene resa affatto. */
	tileLine: (kind: Kind) => ReactNode | null;
	coverLine: (kind: Kind) => ReactNode | null;
};

function TileStatus({
	icon,
	text,
	tone,
}: {
	icon: ReactNode;
	text: string;
	tone: string;
}) {
	return (
		<span className={`inline-flex items-center gap-1 text-xs ${tone}`}>
			{icon}
			{text}
		</span>
	);
}

function knownTileLine(kind: "open" | "closed") {
	return (
		<TileStatus
			icon={<Clock className="size-3" aria-hidden />}
			text={KNOWN_LABEL[kind]}
			tone={kind === "open" ? "text-primary" : "text-muted-foreground"}
		/>
	);
}

function CoverBadge({
	icon,
	text,
	iconTone,
}: {
	icon: ReactNode;
	text: string;
	iconTone: string;
}) {
	return (
		<span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 font-medium text-ink text-xs">
			<span className={iconTone}>{icon}</span>
			{text}
		</span>
	);
}

function knownCoverLine(kind: "open" | "closed") {
	return (
		<CoverBadge
			icon={<Clock className="size-3.5" aria-hidden />}
			text={KNOWN_LABEL[kind]}
			iconTone={kind === "open" ? "text-saffron-deep" : "text-ink/60"}
		/>
	);
}

const VARIANTS: Variant[] = [
	{
		id: "a",
		title: "A · Niente",
		note:
			"La riga sparisce. Non affermiamo nulla, ma la tile perde una riga e " +
			"la griglia si disallinea: guarda il bordo inferiore rispetto alle " +
			"tile accanto. Sulla scheda negozio resta un buco sotto il nome.",
		tileLine: (kind) => (kind === "unknown" ? null : knownTileLine(kind)),
		coverLine: (kind) => (kind === "unknown" ? null : knownCoverLine(kind)),
	},
	{
		id: "b",
		title: "B · Stesso peso di «Chiuso»",
		note:
			"Stessa icona, stesso colore, stessa posizione: cambia solo il testo. " +
			"Massima leggibilità, ma l'orologio suggerisce un orario che non " +
			"esiste e il negozio pesa quanto uno che sappiamo chiuso.",
		tileLine: (kind) =>
			kind === "unknown" ? (
				<TileStatus
					icon={<Clock className="size-3" aria-hidden />}
					text="Orari non disponibili"
					tone="text-muted-foreground"
				/>
			) : (
				knownTileLine(kind)
			),
		coverLine: (kind) =>
			kind === "unknown" ? (
				<CoverBadge
					icon={<Clock className="size-3.5" aria-hidden />}
					text="Orari non disponibili"
					iconTone="text-ink/60"
				/>
			) : (
				knownCoverLine(kind)
			),
	},
	{
		id: "c",
		title: "C · Stesso tono, icona diversa",
		note:
			"Punto interrogativo al posto dell'orologio, stesso colore di «Chiuso». " +
			"La riga tiene l'allineamento della griglia e si distingue per il " +
			"simbolo, non per il tono: l'orologio resta di chi un orario ce l'ha.",
		tileLine: (kind) =>
			kind === "unknown" ? (
				<TileStatus
					icon={<HelpCircle className="size-3" aria-hidden />}
					text="Orari non indicati"
					tone="text-muted-foreground"
				/>
			) : (
				knownTileLine(kind)
			),
		coverLine: (kind) =>
			kind === "unknown" ? (
				<CoverBadge
					icon={<HelpCircle className="size-3.5" aria-hidden />}
					text="Orari non indicati"
					iconTone="text-ink/60"
				/>
			) : (
				knownCoverLine(kind)
			),
	},
	{
		id: "d",
		title: "D · Senza icona nella griglia",
		note:
			"Nessuna icona sulla tile: l'assenza di simbolo è già il segnale. " +
			"Rischio confermato a schermo: senza icona la riga si legge come una " +
			"terza riga dell'indirizzo, non come uno stato.",
		tileLine: (kind) =>
			kind === "unknown" ? (
				<TileStatus
					icon={null}
					text="Orari non indicati"
					tone="text-muted-foreground"
				/>
			) : (
				knownTileLine(kind)
			),
		coverLine: (kind) =>
			kind === "unknown" ? (
				<CoverBadge
					icon={<CalendarOff className="size-3.5" aria-hidden />}
					text="Orari non indicati"
					iconTone="text-ink/60"
				/>
			) : (
				knownCoverLine(kind)
			),
	},
];

// ---------------------------------------------------------------------------

function PreviewTile({
	sample,
	variant,
}: {
	sample: Sample;
	variant: Variant;
}) {
	const line = variant.tileLine(sample.kind);
	return (
		<div className="flex flex-col gap-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border">
				<TileImage url={null} name={sample.name} />
				<span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-cream px-2 py-1 font-medium font-mono text-ink text-xs tabular-nums shadow-sm">
					850 m
				</span>
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug">
					{sample.name}
				</h3>
				<p className="text-muted-foreground text-sm">
					{sample.category} · {sample.city} ({sample.province})
				</p>
				{line}
			</div>
		</div>
	);
}

function PreviewCover({
	sample,
	variant,
}: {
	sample: Sample;
	variant: Variant;
}) {
	return (
		<div className="relative h-56 w-full overflow-hidden rounded-lg">
			<div className="absolute inset-0 bg-gradient-to-br from-saffron to-saffron-deep" />
			<div
				className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/25 to-transparent"
				aria-hidden
			/>
			<div className="absolute inset-x-0 bottom-0 p-5">
				<h1 className="font-bold font-display text-3xl text-cream leading-tight tracking-[-0.015em] drop-shadow-sm">
					{sample.name}
				</h1>
				<p className="mt-1 text-cream/85 text-sm">
					{sample.category} · {sample.city} ({sample.province})
				</p>
				{variant.coverLine(sample.kind)}
			</div>
		</div>
	);
}

const WORDINGS = [
	{
		text: "Orari non disponibili",
		note: "Neutro. «Non disponibili» può però leggersi come un guasto nostro.",
	},
	{
		text: "Orari non indicati",
		note: "Attribuisce l'assenza al negozio senza accusarlo. Il più asciutto.",
	},
	{
		text: "Orari non comunicati",
		note: "Uguale, ma «comunicati» suona burocratico in una tile.",
	},
	{
		text: "Il negozio non ha indicato gli orari",
		note: "Esplicitissimo, ma va a capo su due righe nella tile: rompe la griglia.",
	},
	{
		text: "Orari da confermare",
		note: "Suggerisce che qualcuno li confermerà. Promette una cosa che non facciamo.",
	},
];

function PreviewPage() {
	return (
		<div className="mx-auto w-full max-w-6xl px-4 py-10">
			<header className="mb-10 border-border border-b pb-6">
				<p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
					Anteprima temporanea · da cancellare prima della PR
				</p>
				<h1 className="mt-2 font-bold font-display text-3xl text-foreground">
					Negozio senza orari dichiarati
				</h1>
				<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
					Oggi questi negozi mostrano «Chiuso», che è un'affermazione che non
					possiamo sostenere. In ogni variante le prime due tile sono lo stato
					attuale (aperto, chiuso) e restano identiche a main: cambia solo come
					sono rese le ultime due, che sono i negozi di cui non sappiamo nulla.
					Prova anche in dark mode.
				</p>
				<p className="mt-3 max-w-2xl rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground text-xs leading-relaxed">
					<strong className="font-medium text-foreground">
						Una variante è già stata scartata:
					</strong>{" "}
					«più leggera» ottenuta abbassando l'opacità del testo (
					<code className="font-mono">text-muted-foreground/70</code>) misura
					3,05 di contrasto in light e 3,49 in dark, sotto la soglia AA di 4,5
					per il testo piccolo. Tutte le varianti qui sotto stanno a 5,7–5,9: la
					differenza di peso passa dall'icona, non dal tono.
				</p>
			</header>

			<section className="mb-14">
				<h2 className="mb-6 font-display font-semibold text-foreground text-xl">
					1. Griglia dei risultati
				</h2>
				<div className="flex flex-col gap-12">
					{VARIANTS.map((variant) => (
						<div key={variant.id}>
							<h3 className="font-medium text-foreground text-sm">
								{variant.title}
							</h3>
							<p className="mt-1 mb-4 max-w-2xl text-muted-foreground text-xs leading-relaxed">
								{variant.note}
							</p>
							<div className="grid grid-cols-2 items-start gap-x-4 gap-y-6 sm:grid-cols-4">
								{SAMPLES.map((sample) => (
									<PreviewTile
										key={sample.name}
										sample={sample}
										variant={variant}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			</section>

			<section className="mb-14">
				<h2 className="mb-6 font-display font-semibold text-foreground text-xl">
					2. Scheda negozio (badge sulla copertina)
				</h2>
				<div className="grid gap-8 lg:grid-cols-2">
					{VARIANTS.map((variant) => (
						<div key={variant.id}>
							<h3 className="mb-3 font-medium text-foreground text-sm">
								{variant.title}
							</h3>
							<PreviewCover sample={SAMPLES[2]} variant={variant} />
						</div>
					))}
				</div>
				<p className="mt-4 max-w-2xl text-muted-foreground text-xs">
					Nota: sulla copertina la variante A lascia un vuoto evidente sotto la
					città, perché il badge è l'unico elemento di quella riga.
				</p>
			</section>

			<section>
				<h2 className="mb-2 font-display font-semibold text-foreground text-xl">
					3. Testo
				</h2>
				<p className="mb-5 max-w-2xl text-muted-foreground text-sm">
					Asse indipendente dal peso visivo: scegli separatamente.
				</p>
				<ul className="flex flex-col gap-3">
					{WORDINGS.map((w) => (
						<li
							key={w.text}
							className="flex flex-col gap-1 rounded-lg border border-border p-4 sm:flex-row sm:items-baseline sm:gap-6"
						>
							<span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs sm:w-64">
								<HelpCircle className="size-3" aria-hidden />
								{w.text}
							</span>
							<span className="text-muted-foreground/80 text-xs">{w.note}</span>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
