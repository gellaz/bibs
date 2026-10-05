import { typeboxResolver as baseTypeboxResolver } from "@hookform/resolvers/typebox";
import { registerTypeboxErrors } from "./typebox-errors";

// I form TypeBox importano il resolver da qui, non da @hookform/resolvers:
// così i messaggi tradotti sono registrati prima della prima validazione, e
// TypeBox resta nei chunk dei form invece che in quello d'ingresso.
registerTypeboxErrors();

export const typeboxResolver = baseTypeboxResolver;
