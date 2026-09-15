from pathlib import Path
import sqlite3, json
ROOT=Path(__file__).resolve().parents[1]
con=sqlite3.connect(':memory:')
con.executescript((ROOT/'schema.sql').read_text())

def cols(t): return {r[1] for r in con.execute(f'pragma table_info({t})')}
for table in ['purchases','practices','sessions','messages','rate_limits']:
    assert con.execute("select 1 from sqlite_master where type='table' and name=?",(table,)).fetchone(), table
assert {'provider_order_id','email','status'} <= cols('purchases')
assert {'purchase_id','questions_asked','result_json','processing_token'} <= cols('practices')

con.execute("insert into purchases(id,provider,provider_order_id,email,status) values('p1','stan','o1','a@b.it','active')")
try:
    con.execute("insert into purchases(id,provider,provider_order_id,email,status) values('p2','stan','o1','a@b.it','active')")
    raise AssertionError('provider_order_id non unique')
except sqlite3.IntegrityError: pass
con.execute("insert into practices(id,purchase_id,email) values('pr1','p1','a@b.it')")
try:
    con.execute("insert into practices(id,purchase_id,email) values('pr2','p1','a@b.it')")
    raise AssertionError('una vendita ha creato due pratiche')
except sqlite3.IntegrityError: pass
try:
    con.execute("update practices set questions_asked=14 where id='pr1'")
    raise AssertionError('limite 13 non protetto dal DB')
except sqlite3.IntegrityError: pass
con.execute("insert into sessions(id,practice_id,token_hash,expires_at) values('s1','pr1','h1','2099-01-01T00:00:00Z')")
try:
    con.execute("insert into sessions(id,practice_id,token_hash,expires_at) values('s2','pr1','h1','2099-01-01T00:00:00Z')")
    raise AssertionError('token hash non unique')
except sqlite3.IntegrityError: pass
print('OK schema D1: tabelle, vincoli, 1 acquisto=1 pratica, max 13 protetti.')
