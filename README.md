# Bollo Chiaro 2026 — progetto nuovo da zero (v3.0.0)

Questa cartella è una ricostruzione completa, non una modifica del vecchio progetto.

## Funzionamento definitivo

- accesso solo con l'email usata per l'acquisto;
- ogni acquisto crea al massimo una pratica;
- la pratica può essere ripresa finché è attiva;
- l'IA fa una domanda alla volta e può concludere prima;
- massimo 13 domande di approfondimento dell'IA; dopo la risposta alla 13ª deve produrre il risultato;
- OpenAI viene chiamato solo dal Worker, mai dal browser;
- modello configurato: `gpt-5.6-terra` via Responses API + Structured Outputs;
- errori OpenAI non fanno avanzare il contatore e non salvano il messaggio come turno riuscito;
- risultato personalizzato stampabile/salvabile in PDF dal browser;
- pulsante guida PDF Stan Store già configurato;
- provisioning acquisti via `POST /api/provision`;
- diagnostica protetta via `POST /api/diagnostic`;
- messaggi della pratica eliminati quando viene prodotto il risultato finale;
- risultato finale eliminato automaticamente dopo 30 giorni; sessioni scadute e rate limit ripuliti ogni giorno.

## Le sole configurazioni esterne inevitabili

1. Il nuovo database Cloudflare D1 `bollo-chiaro-2026` è già stato creato e il suo `database_id` è configurato in `wrangler.jsonc`.
2. Lo schema `schema.sql` è già stato eseguito sul nuovo D1.
3. Impostare i secret Cloudflare: `OPENAI_API_KEY`, `APP_SECRET`, `PROVISION_SECRET`.
4. Collegare Stan/Zapier a `/api/provision`, filtrando il prodotto Bollo Chiaro e mappando `email` + un identificativo univoco di transazione/acquisto come `order_id`.

Non mettere mai i secret nel repository.

## Test locali inclusi

```bash
npm test
```

I test controllano: sintassi/logica core, schema D1 e vincoli, massimo 13, una vendita/una pratica, Structured Outputs, Secrets Store `.get()`, link PDF, provisioning, diagnostica e coerenza versione frontend/backend.
