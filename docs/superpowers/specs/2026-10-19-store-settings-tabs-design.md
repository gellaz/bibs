# Impostazioni negozio a schede — design

**Date:** 2026-10-19
**Status:** approvato da Marco (variante A e disposizione «mista» scelte sulla preview `/store/preview`, route temporanea)

## Problema

La pagina `/store` del seller è un modulo lungo con una colonna laterale stretta (Vetrina, Tipologie
d'acquisto, Scorta bassa) che rende marginali foto e modalità di vendita. I giorni di chiusura stanno
su un'altra pagina (`/store/closures`), raggiungibile solo da un link dopo il Salva. La pagina salva
in cinque modi diversi: modulo con Salva in fondo, switch che salvano subito, «Tempo per ritirare» e
«Scorta bassa» con il loro Salva, foto nuove caricate solo dal Salva del modulo (che però non si
abilita se cambiano solo le foto) mentre quelle tolte spariscono subito, chiusure con un altro Salva.

## Decisioni

1. **Tre schede** con `TabNav` (`@bibs/ui/custom/tab-nav`), scheda nella search `?sezione=`:
   `profilo` (default) · `orari` · `vendita`. Etichette: «Profilo negozio», «Orari e chiusure»,
   «Vendita».
2. **Un Salva per scheda**, stessa barra in tutte (oggi in fondo a `StoreForm`: «Modifiche non
   salvate» + Salva, appiccicata in basso quando c'è qualcosa da salvare). Niente salvataggi
   immediati dentro le schede, tranne l'eliminazione di una foto già caricata (resta com'è oggi).
3. **Le schede visitate restano montate** (nascoste): cambiare scheda non butta le modifiche.
4. **Profilo negozio**, a tutta larghezza come le altre schede (scelta di Marco dopo la prima
   prova: la colonna da 768 px lasciava un vuoto a destra): Vetrina in cima, poi Identità,
   Indirizzo, Contatti, con i campi corti affiancati (`FormSection grid`: Nome | Descrizione,
   Indirizzo | riga 2, Comune+CAP, Telefoni | Sito); ricerca e mappa a tutta riga. Aggiungere
   solo foto abilita il Salva.
5. **Orari e chiusure**, affiancati da `@5xl` (7fr / 5fr), in colonna sotto:
   - orari settimanali (l'editor di oggi);
   - **una sola lista di chiusure in ordine di data**, festività e chiusure del negozio insieme,
     **tutte visibili** (niente «Mostra tutte»). Festività: selettore Chiuso / Aperto. Chiusure del
     negozio: rimuovi. «Aggiungi chiusura» apre sul posto Dal / Al (opzionale) / Nota.
   - Le chiusure del negozio già finite non si mostrano e si rimandano intatte al salvataggio.
   - Un Salva per orari + chiusure (due chiamate: PATCH negozio, PUT chiusure).
   - `/store/closures` sparisce; i link della home portano a `/store?sezione=orari`.
6. **Vendita**, affiancate da `@5xl` come Orari e chiusure (7fr / 5fr): Tipologie d'acquisto (con
   «Tempo per ritirare» annidato e lo stato dei pagamenti online) | Scorta bassa. Un Salva (PATCH order-types + PATCH negozio).
7. **Zona di pericolo** fuori dalle impostazioni negozio: la cancellazione resta in Abbonamento
   (`/billing`, menu di ogni negozio), che già la offre.
8. **Dipendente** (sola lettura): schede Profilo negozio e Orari e chiusure (solo orari, le chiusure
   sono del titolare), niente Vendita, niente barra di salvataggio.

## Fuori scope

- Galleria con copertina grande vista in preview: per ora resta `ProductImageDropzone`.
- Modifica sul posto di una chiusura esistente: si toglie e si riaggiunge.
- Avviso di modifiche non salvate quando si esce dalla pagina (oggi non c'è).
