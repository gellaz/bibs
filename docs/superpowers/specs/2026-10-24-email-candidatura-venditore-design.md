# Email della candidatura venditore — design

## Perché

Oggi il venditore non riceve nessuna email dopo la verifica dell'indirizzo: non sa
quando la candidatura entra in revisione né quando viene decisa, e se viene
rifiutata vede solo «Contatta il supporto», senza motivo. L'admin non può dire
perché rifiuta, e un errore banale (foto del documento sfocata) chiude la porta
per sempre.

## Cosa si costruisce

**Tre email al venditore** (destinatario: l'email dell'utente del `seller_profile`):

1. **Candidatura ricevuta** — quando lo stato diventa `pending_review` (fine dati
   aziendali, o reinvio dopo una correzione).
2. **Account approvato** — quando l'admin verifica. Link all'app venditore per
   creare il primo negozio.
3. **Candidatura respinta** — quando l'admin rifiuta. Sempre: il motivo scritto
   dall'admin e il link per contattare il supporto. Se il rifiuto è correggibile,
   anche il pulsante «Correggi e reinvia» verso lo step da rifare.

**Motivo obbligatorio al rifiuto.** L'admin sceglie da una lista o scrive a mano
(«Altro»). Ogni voce della lista ha un esito fisso:

| Motivo | Esito |
|---|---|
| Documento illeggibile | correggibile → ricarica il documento |
| Documento scaduto o non valido | correggibile → ricarica il documento |
| Dati del documento diversi dalla foto | correggibile → ricarica il documento |
| P.IVA non valida o diversa dalla ragione sociale | correggibile → reinserisce i dati aziendali |
| Attività non ammessa su bibs | definitivo |
| Identità non verificabile | definitivo |
| Altro (testo libero) | l'admin sceglie: definitivo / ricarica documento / dati aziendali |

**Rifiuto correggibile.** Il venditore torna allo step da rifare (`pending_document`
o `pending_company`) e vede il motivo in cima alla pagina. Non rifà gli step
corretti: dopo il documento va dritto in revisione. Per i dati aziendali li
reinserisce (form vuoto). Al reinvio riparte l'email «candidatura ricevuta» e la
pratica torna in coda all'admin.

**Rifiuto definitivo.** Come oggi (`rejected`, P.IVA `rejected`), ma la pagina
mostra il motivo e il link al supporto.

## Decisioni (di Marco)

- Lista con voci predefinite + testo libero; motivo nell'email; link al supporto.
- Alcuni rifiuti (documento) permettono di ricaricare e reinviare.
- Lista dei motivi approvata così com'è.

## Scelte mie

- La lista è fissa nel codice, in italiano (va testuale nell'email anche se l'admin
  usa l'interfaccia in inglese). Non è modificabile da Configurazioni.
- Si salva solo il testo del motivo (`seller_profiles.rejection_reason`), niente
  codice né storico. L'esito è nello stato di onboarding.
- Il motivo resta salvato fino all'approvazione (non al reinvio, come detto in
  chat): così durante la nuova revisione l'admin vede perché l'aveva respinta.
- Supporto = `supporto@bibs.it` come `mailto:`, costante condivisa API/app venditore.
- Le email non bloccano mai la moderazione: se l'invio fallisce si logga e basta
  (stesso schema delle email di billing).
- I venditori in correzione spariscono dalla lista admin di default (che mostra
  solo in revisione/attivi/rifiutati) finché non reinviano.

## Fuori scope

Storico dei rifiuti, lista motivi modificabile, form aziendale precompilato dopo
un rifiuto P.IVA, notifica agli admin di nuove candidature.
