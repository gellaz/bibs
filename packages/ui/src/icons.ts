/**
 * Alias semantici per i glifi con significato fissato in tutta l'app.
 * I call-site dichiarano l'intento, la scelta del glifo vive qui:
 * cambiarla in futuro è un'unica riga.
 *
 * `CreateIcon`: creazione di una nuova entità (Nuovo Prodotto, Nuova
 * promozione, Aggiungi negozio, header dei form in modalità create).
 * NON per l'append inline a liste dentro i form (lì resta il Plus
 * nudo) né per gli incrementi numerici (+/− dello stock).
 */
export { CirclePlusIcon as CreateIcon } from "lucide-react";
