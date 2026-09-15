from pathlib import Path
import sqlite3, datetime
ROOT=Path(__file__).resolve().parents[1]
con=sqlite3.connect(':memory:')
con.executescript((ROOT/'schema.sql').read_text())

# Due acquisti reali distinti della stessa persona = due pratiche possibili, non una sola pratica riutilizzabile.
con.execute("insert into purchases(id,provider,provider_order_id,email,status) values('p1','stan','tx1','u@example.it','active')")
con.execute("insert into purchases(id,provider,provider_order_id,email,status) values('p2','stan','tx2','u@example.it','active')")
con.execute("insert into practices(id,purchase_id,email) values('pr1','p1','u@example.it')")

# Una pratica può ricevere al massimo 13 domande IA.
for n in range(1,14):
    con.execute("update practices set questions_asked=? where id='pr1'",(n,))
assert con.execute("select questions_asked from practices where id='pr1'").fetchone()[0]==13
try:
    con.execute("update practices set questions_asked=14 where id='pr1'")
    raise AssertionError('DB ha accettato 14 domande')
except sqlite3.IntegrityError:
    pass

# Chiusura: risultato conservato, cronologia eliminabile.
con.execute("insert into messages(practice_id,role,content) values('pr1','user','caso')")
con.execute("insert into messages(practice_id,role,content) values('pr1','assistant','domanda')")
con.execute("update practices set status='completed',result_json='{}',completed_at=datetime('now') where id='pr1'")
con.execute("delete from messages where practice_id='pr1'")
assert con.execute("select count(*) from messages where practice_id='pr1'").fetchone()[0]==0
assert con.execute("select result_json from practices where id='pr1'").fetchone()[0]=='{}'

# Il secondo acquisto può avere la sua nuova pratica.
con.execute("insert into practices(id,purchase_id,email) values('pr2','p2','u@example.it')")
assert con.execute("select count(*) from practices where email='u@example.it'").fetchone()[0]==2

# Idempotenza ordine per provider; lo stesso id può esistere per provider diverso senza collisione artificiale.
try:
    con.execute("insert into purchases(id,provider,provider_order_id,email,status) values('p3','stan','tx1','u@example.it','active')")
    raise AssertionError('duplicato Stan non bloccato')
except sqlite3.IntegrityError:
    pass
con.execute("insert into purchases(id,provider,provider_order_id,email,status) values('p4','manual','tx1','u@example.it','active')")

# datetime ISO delle sessioni è parseabile da SQLite usando datetime(expires_at), come nel cleanup.
con.execute("insert into sessions(id,practice_id,token_hash,expires_at) values('s-exp','pr2','hash-exp','2000-01-01T00:00:00.000Z')")
con.execute("delete from sessions where datetime(expires_at) < datetime('now')")
assert con.execute("select count(*) from sessions where id='s-exp'").fetchone()[0]==0
print('OK business flow: 13 domande IA, chiusura, secondo acquisto, idempotenza provider, cleanup sessioni.')
