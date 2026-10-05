import { zodIssueRule } from "@bibs/ui/lib/zod-issue-rule";
import { type core, z } from "zod";
import { ruleMessage } from "./rule-message";

// Messaggi predefiniti dei form zod: zod 4 usa l'error map globale solo dove
// lo schema non scrive un messaggio (quelli scritti vincono sempre), e la
// chiama alla lettura delle issue, quindi Paraglide dà la lingua corrente anche
// dopo un cambio senza reload. Sotto il campo c'è già l'etichetta: il
// messaggio dice solo la regola, con le stesse voci dei form TypeBox.

export function zodErrorMessage(issue: core.$ZodRawIssue): string {
	return ruleMessage(zodIssueRule(issue));
}

/** Registra l'error map per tutti gli schemi zod dell'app. */
export function registerZodErrors(): void {
	z.config({ localeError: zodErrorMessage });
}
