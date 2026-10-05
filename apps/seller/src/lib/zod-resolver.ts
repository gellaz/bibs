import { zodResolver as baseZodResolver } from "@hookform/resolvers/zod";
import { registerZodErrors } from "./zod-errors";

// I form zod importano il resolver da qui, non da @hookform/resolvers: così i
// messaggi tradotti sono registrati prima della prima validazione, e l'error
// map resta nei chunk dei form invece che in quello d'ingresso.
registerZodErrors();

export const zodResolver = baseZodResolver;
