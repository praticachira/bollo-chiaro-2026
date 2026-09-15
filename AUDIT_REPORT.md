# Audit Bollo Chiaro v3.0.0

Ricostruito da zero il 15/09/2026.

## Confini del test

Testabile localmente: struttura del progetto, sintassi JavaScript, funzioni pure, richiesta OpenAI simulata, schema SQL, vincoli D1, logica del limite 13, configurazione frontend, endpoint previsti, sicurezza statica, pacchetto ZIP.

Non testabile senza credenziali/servizi dell'utente: deploy reale Cloudflare, vero D1 remoto, vera `OPENAI_API_KEY`, credito/rate limit OpenAI, evento reale Stan/Zapier. Per questo è incluso `/api/diagnostic`, da usare subito dopo il deploy e prima di Stan.

## Scelte di robustezza

- nuovo DB: nessuna migrazione del vecchio schema;
- token sessione casuale, in D1 solo HMAC del token;
- più sessioni possono riaprire la stessa pratica senza creare una seconda pratica;
- `UNIQUE(purchase_id)` impedisce due pratiche per lo stesso acquisto;
- `CHECK questions_asked BETWEEN 0 AND 13` protegge il limite anche a livello DB;
- lock con scadenza evita due risposte concorrenti sulla stessa pratica;
- i messaggi vengono registrati solo dopo una risposta OpenAI valida;
- al completamento la cronologia viene cancellata;
- provisioning idempotente su `provider_order_id` e rifiuta collisioni con email/provider diversi;
- versione frontend/backend verificata tramite `x-app-version`;
- static assets `no-store` per ridurre cache di versioni vecchie;
- nessuna libreria/CDN terza nel browser.

## Esito test automatici finali

- `node --check src/index.js`: OK
- `node --check public/app.js`: OK
- Node test suite: 10/10 OK
- schema D1: OK
- business flow simulato: OK
- controlli statici: OK

Il business-flow test verifica esplicitamente: massimo 13 domande IA, impossibilità di una 14ª a livello DB, 1 acquisto = 1 pratica, secondo acquisto = seconda pratica, cancellazione cronologia al risultato, idempotenza ordine per provider e cleanup sessioni.
