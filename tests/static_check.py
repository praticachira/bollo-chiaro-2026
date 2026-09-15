from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1]
worker=(ROOT/'src/index.js').read_text()
html=(ROOT/'public/index.html').read_text()
app=(ROOT/'public/app.js').read_text()
wr=(ROOT/'wrangler.jsonc').read_text()
schema=(ROOT/'schema.sql').read_text()
checks={
 'model terra': 'gpt-5.6-terra' in worker and 'gpt-5.6-terra' in wr,
 'responses endpoint': 'https://api.openai.com/v1/responses' in worker,
 'store false': 'store:false' in worker,
 'structured outputs': "type:'json_schema'" in worker,
 'max 13': 'MAX_QUESTIONS = 13' in worker,
 'email only login': "body.email" in worker and 'access_code' not in worker,
 'stan pdf link': 'https://stan.store/FEURRADIGITAL/p/non-pagare-il-bollo-auto-guida-completa-legge-104' in html and 'FREE_PDF_URL' in wr,
 'pdf result button': 'Stampa / salva il risultato in PDF' in html and 'window.print()' in app,
 'provision endpoint': '/api/provision' in worker and 'x-provision-secret' in worker,
 'diagnostic endpoint': '/api/diagnostic' in worker,
 'Secrets Store get': "typeof value.get==='function'" in worker,
 'no external CDN': 'https://' not in app and 'cdn' not in html.lower(),
 'CSP': 'Content-Security-Policy' in (ROOT/'public/_headers').read_text(),
 'D1 binding configured': '1943c89d-a8f6-474d-ab33-7cd5c38464be' in wr and 'INSERISCI_QUI_ID_D1_NUOVO' not in wr,
 'version handshake': 'x-app-version' in worker and 'EXPECTED_VERSION' in app,
 'messages delete at completion': "DELETE FROM messages WHERE practice_id=?" in worker,
 'no email in printable result': 'Email:' not in app,
}
failed=[k for k,v in checks.items() if not v]
if failed: raise SystemExit('FAIL static checks: '+', '.join(failed))
print('OK static checks:', ', '.join(checks))
