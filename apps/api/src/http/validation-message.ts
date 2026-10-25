import { z } from "zod";
import { fieldLabel, INVALID, ruleText } from "@/lib/validation-message";
import { type Issue, issueRule, ruleParams } from "@/lib/zod/issues";
import { nodeAt } from "@/lib/zod/mirror";

// Il messaggio italiano del 422 per un'issue di Zod, con le stesse regole di
// `lib/validation-message.ts` sugli errori TypeBox (D6 del piano Hono):
// `error` dello schema, poi «Richiesta non valida» per la radice, poi
// «Etichetta: regola» (etichetta da `title`, dal dizionario o dal path).

type Def = z.core.$ZodTypeDef & Record<string, any>;
const defOf = (schema: z.ZodType) => schema._zod.def as Def;

// Optional e default stanno nello stesso nodo TypeBox: i loro metadati valgono.
function sameNode(schema: z.ZodType): z.ZodType[] {
	const chain = [schema];
	for (let s = schema; ; ) {
		const def = defOf(s);
		if (def.type !== "optional" && def.type !== "default") return chain;
		s = def.innerType;
		chain.push(s);
	}
}

/** `title` ed `error` dello schema che ha prodotto l'issue. */
export function issueMeta(root: z.ZodType, path: PropertyKey[]) {
	const node = nodeAt(root, path);
	const meta: { title?: unknown; error?: unknown } = {};
	for (const s of node ? sameNode(node) : []) {
		const m = z.globalRegistry.get(s);
		meta.title ??= m?.title;
		meta.error ??= m?.error;
	}
	return meta;
}

export function zodValidationMessage(issue: Issue, root: z.ZodType): string {
	const meta = issueMeta(root, issue.path);
	if (typeof meta.error === "string") return meta.error;
	const rule = ruleText(issueRule(issue, nodeAt(root, issue.path)));
	// Errore della decodifica di Elysia (coercizione, t.Integer, t.Date): il
	// nome del campo è perso, resta la regola.
	if (ruleParams(issue)?.decode)
		return rule === INVALID
			? "Valore non valido"
			: `Valore non valido: ${rule}`;
	if (issue.path.length === 0) return "Richiesta non valida";
	const label =
		typeof meta.title === "string"
			? meta.title
			: fieldLabel(`/${issue.path.join("/")}`);
	return `${label}: ${rule}`;
}
