# Audit Bollo Chiaro 2026 — v3.1.0

Audit tecnico del 16/09/2026.

## Verificato automaticamente

- sintassi Worker e frontend;
- schema e vincoli D1;
- un acquisto abilita una sola pratica;
- massimo 13 domande IA;
- errori OpenAI non consumano un turno;
- output strutturato e concreto;
- ripresa pratica e disponibilità risultato per 24 ore;
- consumo dopo stampa/salvataggio PDF;
- link separato al PDF gratuito;
- verifica firma Stripe, compresa rotazione con più firme `v1`;
- normalizzazione pagamenti e rimborsi Stripe/PayPal;
- idempotenza di ordini ed eventi webhook;
- revoca sessioni dopo rimborso o contestazione;
- filtro del prodotto Bollo Chiaro;
- assenza di secret nel browser e di CDN esterne;
- handshake versione frontend/backend.

## Configurazione esterna da validare dal vivo

Il codice locale non può dimostrare il contenuto reale inviato da Stan Store ai conti Stripe e PayPal dell'utente. Prima della vendita pubblica sono obbligatori due acquisti controllati a prezzo minimo, uno con Stripe e uno con PayPal, seguiti dalla verifica dell'accesso e del rimborso/revoca.

L'informativa privacy inclusa descrive il funzionamento tecnico. Prima della vendita il venditore deve coordinare i propri dati identificativi e i recapiti nella pagina Stan Store.

## Criterio di pubblicazione

Il progetto è pronto al deploy quando `npm test` passa. È pronto alla vendita soltanto dopo: diagnostica remota, webhook Stripe, IPN PayPal, accesso con email, completamento pratica, PDF risultato, PDF regalo e revoche per rimborso.
