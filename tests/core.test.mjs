import test from 'node:test';
import assert from 'node:assert/strict';
import {__test} from '../src/index.js';

test('email normalizzata e validata',()=>{
  assert.equal(__test.normalizeEmail('  TEST@Example.COM '),'test@example.com');
  assert.equal(__test.normalizeEmail('nope'),'');
});

test('segreto supporta Worker Secret e Secrets Store .get()',async()=>{
  assert.equal(await __test.requireSecret({X:' abc '},'X'),'abc');
  assert.equal(await __test.requireSecret({X:{get:async()=> ' xyz '}},'X'),'xyz');
  await assert.rejects(()=>__test.requireSecret({},'X'));
});

test('schema consente domanda prima del limite e solo risultato al limite',()=>{
  assert.deepEqual(__test.outputSchema(false).properties.kind.enum,['question','result']);
  assert.deepEqual(__test.outputSchema(true).properties.kind.enum,['result']);
});

test('validazione domanda e risultato',()=>{
  const q=__test.validateAIEnvelope({kind:'question',message:'Qual è la Regione di residenza?',verdict:'none',summary:'',why:'',missing_checks:[],documents:[],next_steps:[],competent_body:'',disclaimer:''},false);
  assert.equal(q.kind,'question');
  const r={kind:'result',message:'',verdict:'da_verificare',summary:'Serve verifica.',why:'Manca una dicitura.',missing_checks:['Verbale'],documents:['Verbale'],next_steps:['Controlla la dicitura'],competent_body:'Ente competente regionale',disclaimer:'Orientamento informativo.'};
  assert.equal(__test.validateAIEnvelope(r,true).kind,'result');
  assert.throws(()=>__test.validateAIEnvelope({kind:'question',message:'Ancora?',verdict:'none',summary:'',why:'',missing_checks:[],documents:[],next_steps:[],competent_body:'',disclaimer:''},true));
});

test('estrazione output Responses API',()=>{
  assert.equal(__test.extractOpenAIText({output:[{type:'message',content:[{type:'output_text',text:' {"a":1} '}]}]}),'{"a":1}');
});

test('prompt contiene regole fondamentali',()=>{
  const p=__test.SYSTEM_PROMPT;
  assert.match(p,/UNA sola domanda principale/i);
  assert.match(p,/13 domande/i);
  assert.match(p,/104 art\. 3 comma 3/i);
  assert.match(p,/non inventare regole regionali/i);
});

test('callOpenAI costruisce Responses API con structured output e forza risultato',async()=>{
  const oldFetch=globalThis.fetch;
  let captured;
  globalThis.fetch=async(_url,opts)=>{
    captured=JSON.parse(opts.body);
    const result={kind:'result',message:'',verdict:'da_verificare',summary:'S',why:'W',missing_checks:[],documents:[],next_steps:['N'],competent_body:'E',disclaimer:'D'};
    return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const out=await __test.callOpenAI({OPENAI_API_KEY:'key',AI_MODEL:'gpt-5.6-terra'},[{role:'user',content:'caso'}],true,13);
    assert.equal(out.kind,'result');
    assert.equal(captured.model,'gpt-5.6-terra');
    assert.equal(captured.store,false);
    assert.equal(captured.text.format.type,'json_schema');
    assert.deepEqual(captured.text.format.schema.properties.kind.enum,['result']);
    assert.equal(captured.reasoning.effort,'medium');
  }finally{globalThis.fetch=oldFetch;}
});

test('errore OpenAI non viene mascherato come output valido',async()=>{
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response('{"error":"bad"}',{status:401});
  try{await assert.rejects(()=>__test.callOpenAI({OPENAI_API_KEY:'bad',AI_MODEL:'gpt-5.6-terra'},[],false,0));}
  finally{globalThis.fetch=oldFetch;}
});

import worker from '../src/index.js';

test('routing meta restituisce versione e header coerente',async()=>{
  const res=await worker.fetch(new Request('https://example.test/api/meta'),{FREE_PDF_URL:'x'});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('x-app-version'),'3.1.0');
  const data=await res.json();
  assert.equal(data.version,'3.1.0');
  assert.equal(data.max_questions,13);
});

test('riconosce esclusivamente i marcatori del prodotto configurati',()=>{
  const env={BOLLO_PRODUCT_MARKERS:'bollo chiaro 2026|accesso bollo'};
  assert.equal(__test.isBolloProduct('Acquisto: Bollo Chiaro 2026',env),true);
  assert.equal(__test.isBolloProduct('Guida invalidità civile',env),false);
});

test('verifica firma Stripe e rifiuta timestamp vecchi',async()=>{
  const secret='whsec_test',raw='{"id":"evt_1"}',now=1700000000;
  const sig=await __test.hmacHex(secret,`${now}.${raw}`);
  assert.equal(await __test.verifyStripeSignature(raw,`t=${now},v1=${sig}`,secret,now),true);
  assert.equal(await __test.verifyStripeSignature(raw,`t=${now},v1=vecchia,v1=${sig}`,secret,now),true);
  assert.equal(await __test.verifyStripeSignature(raw,`t=${now-600},v1=${sig}`,secret,now),false);
});

test('normalizza PayPal IPN completato e rimborso',()=>{
  const paid=__test.normalizePayPalIpn('Completed',{txn_id:'TX1',payer_email:'CLIENTE@EXAMPLE.IT',item_name:'Bollo Chiaro 2026'});
  assert.equal(paid.action,'grant');
  assert.equal(paid.email,'cliente@example.it');
  assert.match(paid.productText,/Bollo Chiaro/);
  const refunded=__test.normalizePayPalIpn('Refunded',{txn_id:'RF1',parent_txn_id:'TX1'});
  assert.equal(refunded.action,'revoke');
  assert.equal(refunded.refs[0].id,'TX1');
  assert.equal(__test.normalizePayPalIpn('Pending',{txn_id:'TX2'}),null);
});

test('provision e diagnostic rifiutano segreto errato prima del DB',async()=>{
  const strong='a'.repeat(40);
  const env={PROVISION_SECRET:strong};
  const p=await worker.fetch(new Request('https://example.test/api/provision',{method:'POST',headers:{'content-type':'application/json','x-provision-secret':'wrong'},body:'{}'}),env);
  assert.equal(p.status,401);
  assert.equal((await p.json()).code,'UNAUTHORIZED');
  const d=await worker.fetch(new Request('https://example.test/api/diagnostic',{method:'POST',headers:{'content-type':'application/json','x-provision-secret':'wrong'},body:'{}'}),env);
  assert.equal(d.status,401);
});
