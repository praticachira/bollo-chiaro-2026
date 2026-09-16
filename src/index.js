const VERSION = '3.1.0';
const MAX_QUESTIONS = 13;
const MAX_MESSAGE_CHARS = 4000;
const encoder = new TextEncoder();

const NATIONAL_GUIDANCE = `
Quadro nazionale di riferimento da usare con prudenza:
- La sola percentuale di invalidità civile o la sola dicitura Legge 104 art. 3 comma 3 non dimostrano automaticamente il diritto all'esenzione bollo auto.
- Le categorie nazionali tipicamente rilevanti per le agevolazioni auto comprendono: non vedenti; sordi; disabilità psichica o mentale con indennità di accompagnamento; grave limitazione della capacità di deambulazione o pluriamputazioni; ridotte o impedite capacità motorie. Per quest'ultima categoria l'adattamento del veicolo può essere determinante.
- In linea nazionale, l'esenzione bollo segue i limiti veicolo usati per l'IVA agevolata: fino a 2.000 cc per benzina o ibrido, fino a 2.800 cc per diesel o ibrido, oppure fino a 150 kW per elettrico.
- In genere il veicolo deve essere intestato alla persona con disabilità oppure al familiare che la ha fiscalmente a carico, e l'esenzione riguarda un solo veicolo.
- Le Regioni possono prevedere estensioni o modalità operative proprie. L'ufficio competente può essere Regione, ACI o Agenzia delle Entrate secondo il territorio.
Queste regole servono per orientare, non per dichiarare un diritto certo senza i dati e la verifica dell'ente competente.`;

const SYSTEM_PROMPT = `Sei Bollo Chiaro 2026, un consulente informativo italiano specializzato nell'orientamento sull'esenzione del bollo auto per persone con disabilità e familiari.

OBIETTIVO
Capire il caso concreto con il minor numero possibile di passaggi e produrre una valutazione pratica. Fai UNA sola domanda principale per messaggio. Puoi concludere prima se hai già informazioni sufficienti. Non superare mai 13 domande di approfondimento dell'IA.

REGOLE
1. Non dare per scontato che invalidità civile, 100%, accompagnamento o Legge 104 art. 3 comma 3, da soli, diano diritto al bollo.
2. Cerca la formulazione/categoria rilevante del verbale senza chiedere di caricare documenti sanitari. Se serve, chiedi all'utente di trascrivere solo la dicitura utile, senza codice fiscale o dati identificativi.
3. Verifica, solo quando serve: categoria di disabilità rilevante, eventuale accompagnamento, limitazione alla deambulazione/capacità motorie e adattamento, intestatario e carico fiscale, Regione, alimentazione/cilindrata o kW, presenza di altra auto già esentata.
4. Non fare domande già risolte dalla conversazione.
5. Non chiedere diagnosi dettagliate se non indispensabili; preferisci gli effetti funzionali e la dicitura del verbale.
6. Non inventare regole regionali. Se una regola locale non è certa, indica chiaramente che va verificata con l'ente competente.
7. Non promettere accoglimento della domanda. Usa 'probabile', 'compatibile', 'da verificare'.
8. Nel risultato non ripetere codice fiscale, targa completa, telefono, email o altri dati identificativi eventualmente inseriti dall'utente.
9. Il risultato deve essere concreto: valutazione, motivazione, controlli mancanti, documenti utili, passi successivi ed ente da contattare.

${NATIONAL_GUIDANCE}`;

const VERDICTS = ['none','probabile_esenzione','probabile_pagamento','da_verificare'];

function outputSchema(forceResult){
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: forceResult ? ['result'] : ['question','result'] },
      message: { type: 'string' },
      verdict: { type: 'string', enum: VERDICTS },
      summary: { type: 'string' },
      why: { type: 'string' },
      missing_checks: { type: 'array', items: { type: 'string' } },
      documents: { type: 'array', items: { type: 'string' } },
      next_steps: { type: 'array', items: { type: 'string' } },
      competent_body: { type: 'string' },
      disclaimer: { type: 'string' }
    },
    required: ['kind','message','verdict','summary','why','missing_checks','documents','next_steps','competent_body','disclaimer']
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:baseHeaders(env)});
      if (url.pathname === '/api/meta' && request.method === 'GET') return json(env,{version:VERSION,max_questions:MAX_QUESTIONS,free_pdf_url:env.FREE_PDF_URL||''});
      if (url.pathname === '/api/health' && request.method === 'GET') return health(env);
      if (url.pathname === '/api/diagnostic' && request.method === 'POST') return diagnostic(request,env);
      if (url.pathname === '/api/provision' && request.method === 'POST') return provision(request,env);
      if (url.pathname === '/api/webhooks/stripe' && request.method === 'POST') return stripeWebhook(request,env);
      if (url.pathname === '/api/webhooks/paypal' && request.method === 'POST') return paypalWebhook(request,env);
      if (url.pathname === '/api/access' && request.method === 'POST') return access(request,env);
      if (url.pathname === '/api/resume' && request.method === 'GET') return resume(request,env);
      if (url.pathname === '/api/chat' && request.method === 'POST') return chat(request,env);
      if (url.pathname === '/api/consume' && request.method === 'POST') return consumeResult(request,env);
      return json(env,{error:'Risorsa non trovata.',code:'NOT_FOUND'},404);
    } catch (error) {
      if(error instanceof PublicError) return json(env,{error:error.message,code:error.code},error.status);
      console.error('Unhandled worker error', safeError(error));
      return json(env,{error:'Servizio momentaneamente non disponibile.',code:'INTERNAL_ERROR'},500);
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(cleanup(env)); }
};

async function access(request, env){
  const appSecret = await requireStrongSecret(env,'APP_SECRET');
  await rateLimit(env,appSecret,request,'login',12,600);
  const body = await readJson(request,10_000);
  const email = normalizeEmail(body.email);
  if(!email) return json(env,{error:'Inserisci l’email usata per l’acquisto.',code:'EMAIL_INVALID'},400);

  let practice = await env.DB.prepare(`
    SELECT pr.id,pr.purchase_id,pr.email,pr.status,pr.questions_asked,pr.result_json
    FROM practices pr JOIN purchases p ON p.id=pr.purchase_id
    LEFT JOIN practice_deliveries pd ON pd.practice_id=pr.id
    WHERE pr.email=? AND p.status='active'
      AND (pr.status='active' OR (pr.status='completed' AND pd.consumed_at IS NULL AND datetime(pd.expires_at)>datetime('now')))
    ORDER BY pr.updated_at DESC LIMIT 1`).bind(email).first();

  if(!practice){
    const purchase = await env.DB.prepare(`
      SELECT p.id,p.email FROM purchases p
      LEFT JOIN practices pr ON pr.purchase_id=p.id
      WHERE p.email=? AND p.status='active' AND pr.id IS NULL
      ORDER BY p.created_at ASC LIMIT 1`).bind(email).first();
    if(purchase){
      const id=crypto.randomUUID();
      try{
        await env.DB.prepare(`INSERT INTO practices(id,purchase_id,email,status,questions_asked,created_at,updated_at) VALUES(?,?,?,'active',0,datetime('now'),datetime('now'))`).bind(id,purchase.id,email).run();
        practice={id,purchase_id:purchase.id,email,status:'active',questions_asked:0,result_json:null};
      }catch{
        practice = await env.DB.prepare(`SELECT pr.id,pr.purchase_id,pr.email,pr.status,pr.questions_asked,pr.result_json FROM practices pr JOIN purchases p ON p.id=pr.purchase_id WHERE pr.purchase_id=? AND pr.status='active' AND p.status='active' LIMIT 1`).bind(purchase.id).first();
      }
    }
  }

  if(!practice){
    const used = await env.DB.prepare(`SELECT 1 AS ok FROM purchases p JOIN practices pr ON pr.purchase_id=p.id WHERE p.email=? AND pr.status='completed' LIMIT 1`).bind(email).first();
    return json(env,{error: used ? 'L’acquisto risulta già utilizzato. Per una nuova pratica serve un nuovo acquisto.' : 'Non trovo un acquisto attivo associato a questa email.',code:used?'PURCHASE_USED':'PURCHASE_NOT_FOUND'},403);
  }

  const token = randomToken(32);
  const tokenHash = await hmacHex(appSecret,token);
  const sessionDays = clampInt(env.SESSION_DAYS,14,1,30);
  const expiresAt = new Date(Date.now()+sessionDays*86400000).toISOString();
  await env.DB.prepare(`INSERT INTO sessions(id,practice_id,token_hash,expires_at) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),practice.id,tokenHash,expiresAt).run();
  const messages=practice.status==='active'?await getMessages(env,practice.id):[];
  return json(env,{token,questions_asked:practice.questions_asked||0,messages,result:practice.result_json?safeJson(practice.result_json):null});
}

async function resume(request,env){
  const auth=await authenticate(request,env,{allowCompleted:true});
  if(auth.error) return auth.error;
  const messages = auth.practice.status==='active' ? await getMessages(env,auth.practice.id) : [];
  return json(env,{questions_asked:auth.practice.questions_asked||0,messages,result:auth.practice.result_json?safeJson(auth.practice.result_json):null});
}

async function chat(request,env){
  const auth=await authenticate(request,env,{allowCompleted:false});
  if(auth.error) return auth.error;
  const {practice,appSecret}=auth;
  await rateLimit(env,appSecret,request,`chat:${practice.id}`,30,600);
  const body=await readJson(request,20_000);
  const message=typeof body.message==='string'?body.message.trim():'';
  if(!message) return json(env,{error:'Scrivi un messaggio.',code:'MESSAGE_EMPTY'},400);
  if(message.length>MAX_MESSAGE_CHARS) return json(env,{error:`Il messaggio è troppo lungo. Massimo ${MAX_MESSAGE_CHARS} caratteri.`,code:'MESSAGE_TOO_LONG'},400);

  const lock=crypto.randomUUID();
  const lockResult=await env.DB.prepare(`UPDATE practices SET processing_token=?,processing_at=datetime('now') WHERE id=? AND status='active' AND (processing_token IS NULL OR processing_at < datetime('now','-2 minutes'))`).bind(lock,practice.id).run();
  if(!lockResult.meta?.changes) return json(env,{error:'Sto già elaborando un messaggio per questa pratica. Attendi qualche secondo.',code:'BUSY'},409);

  try{
    const fresh=await env.DB.prepare(`SELECT pr.*,p.status AS purchase_status FROM practices pr JOIN purchases p ON p.id=pr.purchase_id WHERE pr.id=?`).bind(practice.id).first();
    if(!fresh||fresh.status!=='active'||fresh.purchase_status!=='active') return json(env,{error:'Questa pratica non è più attiva.',code:'PURCHASE_NOT_ACTIVE'},403);
    const history=await getMessages(env,practice.id);
    const forceResult=(fresh.questions_asked||0)>=MAX_QUESTIONS;
    const ai=await callOpenAI(env,[...history,{role:'user',content:message}],forceResult,fresh.questions_asked||0);
    const validated=validateAIEnvelope(ai,forceResult);

    if(validated.kind==='question'){
      const nextCount=(fresh.questions_asked||0)+1;
      if(nextCount>MAX_QUESTIONS) throw new Error('AI attempted question beyond maximum');
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO messages(practice_id,role,content) VALUES(?,'user',?)`).bind(practice.id,message),
        env.DB.prepare(`INSERT INTO messages(practice_id,role,content) VALUES(?,'assistant',?)`).bind(practice.id,validated.message),
        env.DB.prepare(`UPDATE practices SET questions_asked=?,updated_at=datetime('now'),processing_token=NULL,processing_at=NULL WHERE id=? AND processing_token=?`).bind(nextCount,practice.id,lock)
      ]);
      return json(env,{message:validated.message,questions_asked:nextCount,result:null});
    }

    const resultJson=JSON.stringify(validated.result);
    const resultExpiresAt=new Date(Date.now()+86400000).toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO messages(practice_id,role,content) VALUES(?,'user',?)`).bind(practice.id,message),
      env.DB.prepare(`UPDATE practices SET status='completed',result_json=?,completed_at=datetime('now'),updated_at=datetime('now'),processing_token=NULL,processing_at=NULL WHERE id=? AND processing_token=?`).bind(resultJson,practice.id,lock),
      env.DB.prepare(`INSERT INTO practice_deliveries(practice_id,expires_at) VALUES(?,?) ON CONFLICT(practice_id) DO UPDATE SET expires_at=excluded.expires_at,consumed_at=NULL`).bind(practice.id,resultExpiresAt),
      env.DB.prepare(`DELETE FROM messages WHERE practice_id=?`).bind(practice.id)
    ]);
    return json(env,{questions_asked:fresh.questions_asked||0,result:validated.result});
  } catch(error){
    await env.DB.prepare(`UPDATE practices SET processing_token=NULL,processing_at=NULL WHERE id=? AND processing_token=?`).bind(practice.id,lock).run().catch(()=>{});
    if(error instanceof PublicError) return json(env,{error:error.message,code:error.code},error.status);
    console.error('Chat failure',safeError(error));
    return json(env,{error:'Non sono riuscito a ottenere una risposta dall’IA. Il tentativo non è stato conteggiato: riprova tra poco.',code:'AI_TEMPORARY_ERROR'},503);
  }
}

async function provision(request,env){
  const secret=await requireStrongSecret(env,'PROVISION_SECRET');
  const supplied=request.headers.get('x-provision-secret')||'';
  if(!timingSafeEqual(secret,supplied)) return json(env,{error:'Non autorizzato.',code:'UNAUTHORIZED'},401);
  const body=await readJson(request,15_000);
  const email=normalizeEmail(body.email);
  const orderId=cleanId(body.order_id,160);
  const provider=cleanId(body.provider||'stan',40)||'stan';
  if(!email||!orderId) return json(env,{error:'Sono obbligatori email e order_id.',code:'PROVISION_INVALID'},400);
  const existing=await env.DB.prepare(`SELECT id,email,provider FROM purchases WHERE provider=? AND provider_order_id=? LIMIT 1`).bind(provider,orderId).first();
  if(existing){
    if(existing.email!==email||existing.provider!==provider) return json(env,{error:'Questo order_id esiste già con dati diversi.',code:'ORDER_MISMATCH'},409);
    return json(env,{ok:true,id:existing.id,idempotent:true});
  }
  const id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO purchases(id,provider,provider_order_id,email,status) VALUES(?,?,?,?,'active')`).bind(id,provider,orderId,email).run();
  return json(env,{ok:true,id,idempotent:false},201);
}

async function consumeResult(request,env){
  const auth=await authenticate(request,env,{allowCompleted:true});
  if(auth.error) return auth.error;
  if(auth.practice.status!=='completed'||!auth.practice.result_json) return json(env,{error:'Il risultato non è ancora disponibile.',code:'RESULT_NOT_READY'},409);
  await env.DB.batch([
    env.DB.prepare(`UPDATE practice_deliveries SET consumed_at=datetime('now') WHERE practice_id=? AND consumed_at IS NULL`).bind(auth.practice.id),
    env.DB.prepare(`DELETE FROM sessions WHERE practice_id=?`).bind(auth.practice.id)
  ]);
  return json(env,{ok:true,consumed:true});
}

async function stripeWebhook(request,env){
  const raw=await readRawBody(request,1_000_000);
  const secret=await requireSecret(env,'STRIPE_WEBHOOK_SECRET');
  const signature=request.headers.get('stripe-signature')||'';
  if(!await verifyStripeSignature(raw,signature,secret)) return json(env,{error:'Firma Stripe non valida.',code:'WEBHOOK_SIGNATURE_INVALID'},400);
  let event;try{event=JSON.parse(raw);}catch{throw new PublicError('Evento Stripe non valido.','WEBHOOK_INVALID',400);}
  return processPaymentEvent(env,'stripe',event.id,event.type,event);
}

async function paypalWebhook(request,env){
  const raw=await readRawBody(request,1_000_000);
  const params=new URLSearchParams(raw);
  if(!await verifyPayPalIpn(raw,env)) return json(env,{error:'Notifica PayPal non valida.',code:'WEBHOOK_SIGNATURE_INVALID'},400);
  const txnId=cleanId(params.get('txn_id')||params.get('parent_txn_id'),220);
  const status=cleanId(params.get('payment_status')||params.get('txn_type'),120);
  const eventId=cleanId(params.get('ipn_track_id'),220)||`${txnId}:${status}`;
  return processPaymentEvent(env,'paypal',eventId,status,Object.fromEntries(params.entries()));
}

async function processPaymentEvent(env,provider,eventId,eventType,event){
  if(!cleanId(eventId,220)||!cleanId(eventType,120)) throw new PublicError('Evento incompleto.','WEBHOOK_INVALID',400);
  const seen=await env.DB.prepare(`SELECT status FROM webhook_events WHERE provider=? AND event_id=?`).bind(provider,eventId).first();
  if(seen?.status==='processed'||seen?.status==='ignored') return json(env,{ok:true,idempotent:true});
  await env.DB.prepare(`INSERT INTO webhook_events(provider,event_id,event_type,status) VALUES(?,?,?,'received') ON CONFLICT(provider,event_id) DO NOTHING`).bind(provider,eventId,eventType).run();
  try{
    const normalized=provider==='stripe'?await normalizeStripeEvent(env,eventType,event):normalizePayPalIpn(eventType,event);
    if(!normalized){await finishWebhook(env,provider,eventId,'ignored','');return json(env,{ok:true,ignored:true});}
    if(normalized.action==='revoke'){
      await revokeByRefs(env,provider,normalized.refs);
      await finishWebhook(env,provider,eventId,'processed','');
      return json(env,{ok:true,revoked:true});
    }
    if(!isBolloProduct(normalized.productText,env)){await finishWebhook(env,provider,eventId,'ignored','product_mismatch');return json(env,{ok:true,ignored:true});}
    if(!normalized.email||!normalized.orderId) throw new PublicError('Nel pagamento mancano email o identificativo ordine.','PAYMENT_DATA_MISSING',422);
    const purchase=await createPurchase(env,provider,normalized.orderId,normalized.email);
    for(const ref of normalized.refs||[]) if(cleanId(ref.id,220)) await env.DB.prepare(`INSERT INTO payment_refs(provider,external_id,purchase_id,kind) VALUES(?,?,?,?) ON CONFLICT(provider,external_id) DO UPDATE SET purchase_id=excluded.purchase_id,kind=excluded.kind`).bind(provider,ref.id,purchase.id,cleanId(ref.kind,40)||'payment').run();
    await finishWebhook(env,provider,eventId,'processed','');
    return json(env,{ok:true,purchase_id:purchase.id,idempotent:purchase.idempotent});
  }catch(error){await finishWebhook(env,provider,eventId,'failed',String(error?.code||error?.message||'error').slice(0,180));throw error;}
}

async function createPurchase(env,provider,orderId,email){
  email=normalizeEmail(email); orderId=cleanId(orderId,220); provider=cleanId(provider,40);
  const existing=await env.DB.prepare(`SELECT id,email FROM purchases WHERE provider=? AND provider_order_id=?`).bind(provider,orderId).first();
  if(existing){if(existing.email!==email)throw new PublicError('Ordine già registrato con email diversa.','ORDER_MISMATCH',409);return {id:existing.id,idempotent:true};}
  const id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO purchases(id,provider,provider_order_id,email,status) VALUES(?,?,?,?,'active')`).bind(id,provider,orderId,email).run();
  return {id,idempotent:false};
}

async function normalizeStripeEvent(env,type,event){
  const obj=event?.data?.object||{};
  if(['charge.refunded','charge.dispute.created','payment_intent.canceled'].includes(type)){
    return {action:'revoke',refs:[{id:obj.id,kind:'charge'},{id:obj.payment_intent,kind:'payment_intent'}].filter(x=>x.id)};
  }
  if(!['checkout.session.completed','payment_intent.succeeded'].includes(type)) return null;
  let detail=obj;
  if(type==='checkout.session.completed') detail=await stripeGet(env,`/v1/checkout/sessions/${encodeURIComponent(obj.id)}?expand[]=line_items`);
  else detail=await stripeGet(env,`/v1/payment_intents/${encodeURIComponent(obj.id)}?expand[]=latest_charge`);
  const lineItems=detail?.line_items?.data||[];
  const productText=[detail?.description,detail?.metadata&&Object.values(detail.metadata).join(' '),...lineItems.map(x=>`${x.description||''} ${x.price?.nickname||''}`)].filter(Boolean).join(' ');
  const email=normalizeEmail(detail?.customer_details?.email||detail?.customer_email||detail?.receipt_email||detail?.latest_charge?.billing_details?.email||obj?.receipt_email||'');
  const refs=[{id:detail.id,kind:type.startsWith('checkout')?'checkout_session':'payment_intent'},{id:detail.payment_intent,kind:'payment_intent'},{id:detail.latest_charge?.id||detail.latest_charge,kind:'charge'}].filter(x=>x.id);
  return {action:'grant',orderId:String(detail.payment_intent||detail.id||obj.id),email,productText,refs};
}

function normalizePayPalIpn(status,data){
  const normalized=String(status||'').toLowerCase();
  const txnId=cleanId(data?.txn_id,220),parentId=cleanId(data?.parent_txn_id,220);
  if(['refunded','reversed','denied','voided'].includes(normalized)) return {action:'revoke',refs:[parentId,txnId].filter(Boolean).map(id=>({id,kind:'transaction'}))};
  if(!['completed','processed'].includes(normalized)) return null;
  const productText=[data?.item_name,data?.item_number,data?.custom,data?.invoice].filter(Boolean).join(' ');
  return {action:'grant',orderId:txnId,email:normalizeEmail(data?.payer_email||''),productText,refs:[txnId].filter(Boolean).map(id=>({id,kind:'transaction'}))};
}

async function revokeByRefs(env,provider,refs){
  const ids=(refs||[]).map(x=>cleanId(x.id,220)).filter(Boolean);
  for(const id of ids){
    const ref=await env.DB.prepare(`SELECT purchase_id FROM payment_refs WHERE provider=? AND external_id=?`).bind(provider,id).first();
    if(ref?.purchase_id) await env.DB.batch([
      env.DB.prepare(`UPDATE purchases SET status='revoked' WHERE id=?`).bind(ref.purchase_id),
      env.DB.prepare(`DELETE FROM sessions WHERE practice_id IN (SELECT id FROM practices WHERE purchase_id=?)`).bind(ref.purchase_id)
    ]);
  }
}

async function finishWebhook(env,provider,eventId,status,error){await env.DB.prepare(`UPDATE webhook_events SET status=?,error=?,processed_at=datetime('now') WHERE provider=? AND event_id=?`).bind(status,error||null,provider,eventId).run();}
function isBolloProduct(text,env){const hay=normalizeText(text);const markers=String(env.BOLLO_PRODUCT_MARKERS||'bollo chiaro 2026').split('|').map(normalizeText).filter(Boolean);return !!hay&&markers.some(m=>hay.includes(m));}
async function stripeGet(env,path){const key=await requireSecret(env,'STRIPE_SECRET_KEY');const r=await fetch(`https://api.stripe.com${path}`,{headers:{Authorization:`Bearer ${key}`}});if(!r.ok)throw new PublicError('Stripe non ha restituito i dettagli del pagamento.','STRIPE_API_ERROR',502);return r.json();}
function paypalIpnUrl(env){return String(env.PAYPAL_MODE||'live').toLowerCase()==='sandbox'?'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr':'https://ipnpb.paypal.com/cgi-bin/webscr';}
async function verifyPayPalIpn(raw,env){const r=await fetch(paypalIpnUrl(env),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Bollo-Chiaro-2026-IPN/1.0'},body:`cmd=_notify-validate&${raw}`});return r.ok&&(await r.text()).trim()==='VERIFIED';}
async function verifyStripeSignature(raw,header,secret,now=Math.floor(Date.now()/1000)){
  const fields=header.split(',').map(p=>p.trim().split('=',2)).filter(x=>x.length===2);
  const timestamp=Number(fields.find(([key])=>key==='t')?.[1]);
  const signatures=fields.filter(([key])=>key==='v1').map(([,value])=>value);
  if(!Number.isFinite(timestamp)||Math.abs(now-timestamp)>300||!signatures.length)return false;
  const expected=await hmacHex(secret,`${timestamp}.${raw}`);
  return signatures.some(signature=>timingSafeEqual(expected,signature));
}

async function health(env){
  let db=false;
  try{ const row=await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='purchases'`).first(); db=!!row; }catch{}
  return json(env,{ok:db,version:VERSION,db},db?200:503);
}

async function diagnostic(request,env){
  const secret=await requireStrongSecret(env,'PROVISION_SECRET');
  if(!timingSafeEqual(secret,request.headers.get('x-provision-secret')||'')) return json(env,{error:'Non autorizzato.',code:'UNAUTHORIZED'},401);
  const required=['purchases','practices','sessions','messages','practice_deliveries','payment_refs','webhook_events'];
  const found=[];
  for(const table of required){const r=await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(table).first(); if(r)found.push(table);}
  if(found.length!==required.length) return json(env,{ok:false,stage:'database',error:'Schema D1 incompleto.',found},503);
  try{
    await env.DB.prepare(`SELECT provider,provider_order_id,email,status FROM purchases LIMIT 0`).all();
    await env.DB.prepare(`SELECT purchase_id,questions_asked,result_json,processing_token FROM practices LIMIT 0`).all();
    await env.DB.prepare(`SELECT practice_id,token_hash,expires_at FROM sessions LIMIT 0`).all();
    const appSecret=await requireStrongSecret(env,'APP_SECRET');
    const provisionSecret=await requireStrongSecret(env,'PROVISION_SECRET');
    if(timingSafeEqual(appSecret,provisionSecret)) return json(env,{ok:false,stage:'secrets',error:'APP_SECRET e PROVISION_SECRET devono essere diversi.'},503);
    const key=await requireSecret(env,'OPENAI_API_KEY');
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.AI_MODEL||'gpt-5.6-terra',input:'Rispondi esattamente con OK.',reasoning:{effort:'none'},max_output_tokens:32,store:false})});
    if(!response.ok){const txt=await response.text(); console.error('Diagnostic OpenAI',response.status,txt.slice(0,500)); return json(env,{ok:false,stage:'openai',status:response.status,error:openAIUserMessage(response.status)},503);}
    return json(env,{ok:true,stage:'all',version:VERSION,database:true,openai:true});
  }catch(error){console.error('Diagnostic failure',safeError(error));return json(env,{ok:false,stage:'openai',error:'Configurazione OpenAI non disponibile.'},503);}
}

async function authenticate(request,env,{allowCompleted}){
  const token=bearer(request);
  if(!token) return {error:json(env,{error:'Sessione non valida. Accedi di nuovo.',code:'SESSION_INVALID'},401)};
  const appSecret=await requireStrongSecret(env,'APP_SECRET');
  const tokenHash=await hmacHex(appSecret,token);
  const row=await env.DB.prepare(`SELECT s.id AS session_id,s.expires_at,pr.*,p.status AS purchase_status,pd.consumed_at,pd.expires_at AS result_expires_at FROM sessions s JOIN practices pr ON pr.id=s.practice_id JOIN purchases p ON p.id=pr.purchase_id LEFT JOIN practice_deliveries pd ON pd.practice_id=pr.id WHERE s.token_hash=? LIMIT 1`).bind(tokenHash).first();
  if(!row||new Date(row.expires_at).getTime()<=Date.now()) return {error:json(env,{error:'Sessione scaduta. Accedi di nuovo.',code:'SESSION_INVALID'},401)};
  if(row.purchase_status!=='active') return {error:json(env,{error:'L’acquisto non è più attivo.',code:'PURCHASE_NOT_ACTIVE'},403)};
  if(row.status==='completed'&&(row.consumed_at||(row.result_expires_at&&new Date(row.result_expires_at).getTime()<=Date.now()))) return {error:json(env,{error:'Il risultato è già stato scaricato o non è più disponibile. Per una nuova pratica serve un nuovo acquisto.',code:'PURCHASE_USED'},403)};
  if(!allowCompleted&&row.status!=='active') return {error:json(env,{error:'La pratica è già conclusa.',code:'PRACTICE_COMPLETED'},409)};
  await env.DB.prepare(`UPDATE sessions SET last_seen_at=datetime('now') WHERE id=?`).bind(row.session_id).run().catch(()=>{});
  return {practice:row,appSecret};
}

async function callOpenAI(env,messages,forceResult,questionsAsked){
  const key=await requireSecret(env,'OPENAI_API_KEY');
  const model=env.AI_MODEL||'gpt-5.6-terra';
  const input=messages.map((m)=>({role:m.role==='assistant'?'assistant':'user',content:m.content}));
  const finalInstruction=forceResult ? `Hai già fatto ${questionsAsked} domande di approfondimento. Non puoi fare altre domande: produci ora il miglior risultato possibile, indicando chiaramente ciò che resta da verificare.` : `Hai fatto finora ${questionsAsked} domande di approfondimento. Puoi fare una sola nuova domanda solo se è davvero necessaria, altrimenti concludi.`;
  const payload={
    model,
    instructions:`${SYSTEM_PROMPT}\n\nSTATO DELLA PRATICA\n${finalInstruction}`,
    input,
    reasoning:{effort:'medium'},
    max_output_tokens:3500,
    text:{format:{type:'json_schema',name:'bollo_chiaro_response',strict:true,schema:outputSchema(forceResult)}},
    store:false,
    prompt_cache_key:'bollo-chiaro-2026-v3'
  };
  let response;
  try{response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});}catch{throw new PublicError('OpenAI non è raggiungibile in questo momento. Riprova tra poco.','OPENAI_NETWORK',503);}
  if(!response.ok){const txt=await response.text();console.error('OpenAI API error',response.status,txt.slice(0,800));throw new PublicError(openAIUserMessage(response.status),'OPENAI_ERROR',response.status===429?503:502);}
  const data=await response.json();
  if(data.status==='incomplete') throw new PublicError('La risposta dell’IA è risultata incompleta. Riprova: il tentativo non viene conteggiato.','OPENAI_INCOMPLETE',503);
  const text=extractOpenAIText(data);
  if(!text) throw new Error('OpenAI returned no output text');
  let parsed; try{parsed=JSON.parse(text);}catch{throw new Error('OpenAI returned invalid JSON');}
  return parsed;
}

function validateAIEnvelope(value,forceResult){
  if(!value||typeof value!=='object') throw new Error('Invalid AI envelope');
  if(forceResult&&value.kind!=='result') throw new Error('AI did not finalize at max questions');
  if(value.kind==='question'){
    if(typeof value.message!=='string'||value.message.trim().length<2) throw new Error('Invalid question envelope');
    return {kind:'question',message:value.message.trim(),result:null};
  }
  const result={
    verdict:value.verdict,
    summary:value.summary,
    why:value.why,
    missing_checks:value.missing_checks,
    documents:value.documents,
    next_steps:value.next_steps,
    competent_body:value.competent_body,
    disclaimer:value.disclaimer
  };
  if(value.kind==='result'&&isValidResult(result)) return {kind:'result',message:'',result};
  throw new Error('Invalid result envelope');
}

function isValidResult(r){
  if(!r||typeof r!=='object') return false;
  if(!['probabile_esenzione','probabile_pagamento','da_verificare'].includes(r.verdict)) return false;
  for(const k of ['summary','why','competent_body','disclaimer']) if(typeof r[k]!=='string'||!r[k].trim()) return false;
  for(const k of ['missing_checks','documents','next_steps']) if(!Array.isArray(r[k])||!r[k].every((x)=>typeof x==='string')) return false;
  return r.next_steps.length>0;
}

function extractOpenAIText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim()) return data.output_text.trim();
  for(const item of data?.output||[]){
    if(item?.type!=='message') continue;
    for(const part of item.content||[]){if(part?.type==='output_text'&&typeof part.text==='string') return part.text.trim();}
  }
  return '';
}

async function getMessages(env,practiceId){const rows=await env.DB.prepare(`SELECT role,content FROM messages WHERE practice_id=? ORDER BY id ASC`).bind(practiceId).all();return rows.results||[];}

async function rateLimit(env,secret,request,scope,limit,windowSeconds){
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  const bucket=Math.floor(Date.now()/(windowSeconds*1000));
  const ipHash=(await hmacHex(secret,ip)).slice(0,24);
  const key=`${scope}:${ipHash}:${bucket}`;
  await env.DB.prepare(`INSERT INTO rate_limits(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1`).bind(key).run();
  const row=await env.DB.prepare(`SELECT count FROM rate_limits WHERE key=?`).bind(key).first();
  if((row?.count||0)>limit) throw new PublicError('Troppi tentativi ravvicinati. Attendi qualche minuto e riprova.','RATE_LIMIT',429);
}

async function cleanup(env){
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')`),
    env.DB.prepare(`DELETE FROM rate_limits WHERE created_at < datetime('now','-2 days')`),
    env.DB.prepare(`DELETE FROM messages WHERE practice_id IN (SELECT id FROM practices WHERE status='completed')`),
    env.DB.prepare(`UPDATE practices SET result_json=NULL WHERE status='completed' AND completed_at < datetime('now','-30 days')`),
    env.DB.prepare(`UPDATE practices SET processing_token=NULL,processing_at=NULL WHERE processing_at < datetime('now','-5 minutes')`)
  ]);
}

async function readJson(request,maxBytes){
  const type=request.headers.get('content-type')||'';
  if(!type.toLowerCase().includes('application/json')) throw new PublicError('Richiesta non valida.','BAD_JSON',400);
  const len=Number(request.headers.get('content-length')||0); if(len&&len>maxBytes) throw new PublicError('Richiesta troppo grande.','BODY_TOO_LARGE',413);
  const text=await request.text(); if(text.length>maxBytes) throw new PublicError('Richiesta troppo grande.','BODY_TOO_LARGE',413);
  try{return JSON.parse(text||'{}');}catch{throw new PublicError('JSON non valido.','BAD_JSON',400);}
}

async function readRawBody(request,maxBytes){const len=Number(request.headers.get('content-length')||0);if(len&&len>maxBytes)throw new PublicError('Richiesta troppo grande.','BODY_TOO_LARGE',413);const text=await request.text();if(text.length>maxBytes)throw new PublicError('Richiesta troppo grande.','BODY_TOO_LARGE',413);return text;}

async function requireSecret(env,name){const value=env?.[name]; if(typeof value==='string'&&value.trim()) return value.trim(); if(value&&typeof value.get==='function'){const v=await value.get();if(typeof v==='string'&&v.trim())return v.trim();} throw new Error(`Missing secret ${name}`);}
async function requireStrongSecret(env,name){const v=await requireSecret(env,name);if(v.length<32)throw new Error(`${name} must be at least 32 characters`);return v;}
function normalizeEmail(v){if(typeof v!=='string')return '';const s=v.trim().toLowerCase();return /^\S+@\S+\.\S+$/.test(s)&&s.length<=254?s:'';}
function cleanId(v,max){if(typeof v!=='string'&&typeof v!=='number')return '';const s=String(v).trim();return s&&s.length<=max?s:'';}
function normalizeText(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function bearer(req){const h=req.headers.get('authorization')||'';return h.startsWith('Bearer ')?h.slice(7).trim():'';}
function randomToken(bytes){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return base64url(a);}
function base64url(a){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function hmacHex(secret,value){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,encoder.encode(value));return [...new Uint8Array(sig)].map((b)=>b.toString(16).padStart(2,'0')).join('');}
function timingSafeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function clampInt(value,fallback,min,max){const n=Number.parseInt(value,10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
function safeJson(s){try{return JSON.parse(s);}catch{return null;}}
function safeError(e){return {name:e?.name||'Error',message:String(e?.message||e).slice(0,600)};}
function openAIUserMessage(status){if(status===401||status===403)return 'La connessione OpenAI non è configurata correttamente.';if(status===429)return 'OpenAI ha rifiutato temporaneamente la richiesta per limite o credito. Riprova tra poco.';if(status>=500)return 'OpenAI è temporaneamente non disponibile. Riprova tra poco.';return 'La richiesta a OpenAI non è stata accettata. Controlla la configurazione del modello.';}
function baseHeaders(env){return {'content-type':'application/json; charset=utf-8','cache-control':'no-store, max-age=0','x-content-type-options':'nosniff','x-app-version':VERSION};}
function json(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:baseHeaders(env)});}

class PublicError extends Error{constructor(message,code,status){super(message);this.name='PublicError';this.code=code;this.status=status;}}

export const __test={VERSION,MAX_QUESTIONS,outputSchema,validateAIEnvelope,isValidResult,extractOpenAIText,normalizeEmail,cleanId,normalizeText,isBolloProduct,normalizePayPalIpn,verifyStripeSignature,requireSecret,requireStrongSecret,timingSafeEqual,hmacHex,callOpenAI,SYSTEM_PROMPT,NATIONAL_GUIDANCE};
