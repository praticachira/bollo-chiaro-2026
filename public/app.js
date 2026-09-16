'use strict';

const EXPECTED_VERSION = '3.1.0';
const API = '/api';
const $ = (s) => document.querySelector(s);
const state = { token: localStorage.getItem('bollo_session') || '', busy: false, result: null };
const screens = ['#fatal','#login','#chatScreen','#resultScreen'];

function show(id){ screens.forEach((s)=>$(s).hidden = s !== id); }
function setFatal(text){ $('#fatalText').textContent=text; show('#fatal'); }
function clearSession(){ state.token=''; localStorage.removeItem('bollo_session'); }
function addMessage(role,text){ const el=document.createElement('div'); el.className=`msg ${role}`; el.textContent=text; $('#chat').append(el); $('#chat').scrollTop=$('#chat').scrollHeight; }
function setTyping(on){ const old=$('#typing'); if(old)old.remove(); if(on){const el=document.createElement('div');el.id='typing';el.className='msg bot typing';el.textContent='•••';$('#chat').append(el);$('#chat').scrollTop=$('#chat').scrollHeight;} }
function setCounter(n){ $('#counter').textContent=`${n}/13 domande IA`; }
function listInto(selector,items){ const root=$(selector); root.innerHTML=''; (items||[]).forEach((x)=>{const li=document.createElement('li');li.textContent=x;root.append(li);}); if(!root.children.length){const li=document.createElement('li');li.textContent='Nessun elemento aggiuntivo.';root.append(li);} }

async function request(path,{method='GET',body,auth=true,headers={}}={}){
  const h = { ...headers };
  if(body !== undefined) h['Content-Type']='application/json';
  if(auth && state.token) h.Authorization=`Bearer ${state.token}`;
  let res;
  try{res=await fetch(API+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});}catch{throw new Error('Connessione non disponibile. Controlla internet e riprova.');}
  const version=res.headers.get('x-app-version');
  if(version && version!==EXPECTED_VERSION){ setFatal('Frontend e server non sono della stessa versione. Ricarica la pagina dopo il deploy completo.'); throw new Error('Versione non coerente.'); }
  const data=await res.json().catch(()=>({}));
  if(!res.ok){ const err=new Error(data.error||'Servizio momentaneamente non disponibile.'); err.code=data.code||''; throw err; }
  return data;
}

function renderConversation(data){
  $('#chat').innerHTML='';
  (data.messages||[]).forEach((m)=>addMessage(m.role==='user'?'user':'bot',m.content));
  if(!(data.messages||[]).length){ addMessage('bot','Ciao. Raccontami il tuo caso: che riconoscimento hai, a chi è intestata l’auto e perché pensi di poter avere l’esenzione dal bollo. Ti farò una domanda alla volta solo se serve.'); }
  setCounter(data.questions_asked||0);
}

function renderResult(r){
  state.result=r;
  const titles={probabile_esenzione:'Il tuo caso appare compatibile con l’esenzione',probabile_pagamento:'Dai dati forniti non emerge il diritto all’esenzione',da_verificare:'Servono ancora verifiche ufficiali'};
  const badges={probabile_esenzione:'✓',probabile_pagamento:'!',da_verificare:'?'};
  $('#resultBadge').textContent=badges[r.verdict]||'?';
  $('#resultTitle').textContent=titles[r.verdict]||'Il tuo risultato';
  $('#summary').textContent=r.summary||'';
  $('#why').textContent=r.why||'';
  listInto('#checks',r.missing_checks);
  listInto('#documents',r.documents);
  listInto('#steps',r.next_steps);
  $('#authority').textContent=r.competent_body||'Da verificare presso l’ente competente per il bollo nella tua Regione.';
  $('#disclaimer').textContent=r.disclaimer||'Orientamento informativo: verifica l’esito con l’ente competente prima di assumere decisioni fiscali.';
  $('#generatedAt').textContent=`Generato il ${new Date().toLocaleDateString('it-IT')}`;
  show('#resultScreen');
}

$('#reloadBtn').addEventListener('click',()=>location.reload());
$('#printBtn').addEventListener('click',async()=>{
  window.print();
  try{await request('/consume',{method:'POST'});clearSession();}catch(error){window.alert(error.message||'Non sono riuscito a chiudere la pratica. Riprova.');}
});
$('#logoutBtn').addEventListener('click',()=>{clearSession();$('#chat').innerHTML='';show('#login');});

$('#loginForm').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const email=$('#email').value.trim().toLowerCase();
  $('#loginError').textContent='';
  if(!/^\S+@\S+\.\S+$/.test(email)){ $('#loginError').textContent='Inserisci un indirizzo email valido.'; return; }
  const btn=$('#loginBtn'); btn.disabled=true; btn.textContent='Controllo acquisto…';
  try{
    const data=await request('/access',{method:'POST',body:{email},auth:false});
    state.token=data.token; localStorage.setItem('bollo_session',data.token);
    if(data.result){renderResult(data.result);return;}
    renderConversation(data); show('#chatScreen');
  }catch(err){ $('#loginError').textContent=err.message; }
  finally{btn.disabled=false;btn.textContent='Accedi alla mia pratica';}
});

$('#chatForm').addEventListener('submit',async(e)=>{
  e.preventDefault(); if(state.busy)return;
  const text=$('#message').value.trim(); if(!text)return;
  state.busy=true; $('#chatError').textContent=''; $('#message').value=''; addMessage('user',text); setTyping(true); $('#sendBtn').disabled=true;
  try{
    const data=await request('/chat',{method:'POST',body:{message:text}}); setTyping(false); setCounter(data.questions_asked||0);
    if(data.result){renderResult(data.result);}else{addMessage('bot',data.message);}
  }catch(err){ setTyping(false); $('#chatError').textContent=err.message; $('#message').value=text; if(err.code==='SESSION_INVALID'||err.code==='PURCHASE_NOT_ACTIVE'){clearSession();} }
  finally{state.busy=false;$('#sendBtn').disabled=false;$('#message').focus();}
});

$('#message').addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#chatForm').requestSubmit();}});
$('#message').addEventListener('input',(e)=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,150)+'px';});

(async()=>{
  try{
    const meta=await request('/meta',{auth:false});
    if(meta.version!==EXPECTED_VERSION){setFatal('La pagina e il server non sono della stessa versione. Completa il deploy e ricarica.');return;}
    if(state.token){
      try{const data=await request('/resume'); if(data.result){renderResult(data.result);}else{renderConversation(data);show('#chatScreen');} return;}catch{clearSession();}
    }
    show('#login');
  }catch(err){ if(!$('#fatal').hidden)return; setFatal(err.message||'Impossibile verificare il server.'); }
})();
