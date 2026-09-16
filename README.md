# Bollo Chiaro 2026 — v3.1.0

Web app Cloudflare Worker + D1 che abilita automaticamente una pratica dopo un pagamento Stripe o PayPal, senza Zapier e senza servizi intermedi a pagamento.

## Esperienza cliente

- compra Bollo Chiaro su Stan Store con carta/Stripe oppure PayPal;
- accede con la stessa email usata nell'acquisto, senza password;
- ogni acquisto abilita esattamente una pratica;
- può riprendere una pratica non conclusa;
- l'IA fa una domanda adattiva alla volta e può concludere prima;
- non supera 13 domande di approfondimento;
- riceve valutazione, motivazione, verifiche mancanti, documenti, passi successivi ed ente competente;
- può riaprire il risultato per 24 ore, finché non usa “Stampa / salva il risultato in PDF”;
- dopo il consumo o la scadenza serve un nuovo acquisto per una nuova pratica;
- può scaricare separatamente la guida PDF gratuita in regalo.

## Pagamenti automatici, senza Zapier

### Stripe

Endpoint: `POST /api/webhooks/stripe`

Eventi richiesti:

1. `checkout.session.completed`
2. `payment_intent.succeeded`
3. `charge.refunded`
4. `charge.dispute.created`

Secret Cloudflare richiesti:

- `STRIPE_WEBHOOK_SECRET`: chiave `whsec_...` della destinazione webhook;
- `STRIPE_SECRET_KEY`: chiave privata Stripe, usata dal Worker soltanto per verificare email e prodotto.

### PayPal

Endpoint IPN: `POST /api/webhooks/paypal`

Configurare questo URL nelle notifiche immediate di pagamento (IPN) del conto PayPal Business. Il Worker riconvalida ogni notifica direttamente con PayPal. Non servono API key PayPal. `PAYPAL_MODE` deve essere `live` in produzione e `sandbox` soltanto nel simulatore IPN.

Pagamenti completati abilitano la pratica. Rimborsi, storni, contestazioni Stripe e revoche PayPal revocano l'accesso. Gli eventi duplicati sono idempotenti.

## Protezioni

- filtro prodotto tramite `BOLLO_PRODUCT_MARKERS`;
- firme Stripe e verifiche IPN PayPal;
- riferimenti di pagamento per revoche e rimborsi;
- token sessione casuale, con solo HMAC conservato in D1;
- OpenAI chiamato soltanto dal Worker e con `store:false`;
- cronologia eliminata alla generazione del risultato;
- nessuna libreria o CDN di terze parti nel browser;
- pagina privacy inclusa in `/privacy.html`.

## Deploy

1. Pubblicare l'intera cartella con Cloudflare Workers.
2. Applicare `schema.sql` al D1 configurato in `wrangler.jsonc`.
3. Verificare i secret esistenti: `OPENAI_API_KEY`, `APP_SECRET`, `PROVISION_SECRET`.
4. Aggiungere `STRIPE_WEBHOOK_SECRET` e `STRIPE_SECRET_KEY`.
5. Configurare i quattro eventi Stripe sull'endpoint indicato sopra.
6. Configurare PayPal IPN sul relativo endpoint.
7. Eseguire `/api/diagnostic`, poi un test Stripe e un test PayPal controllati.

Non inserire secret nel repository. `/api/provision` resta disponibile per recuperi manuali autorizzati, ma non serve nel normale flusso Stripe/PayPal.

## Test locali

```bash
npm test
```

La suite controlla sintassi, limite 13, Structured Outputs, schema D1, una vendita/una pratica, idempotenza, firme Stripe, PayPal IPN, rimborsi, consumo del risultato, link PDF gratuito e coerenza frontend/backend.
