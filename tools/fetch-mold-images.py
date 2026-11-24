"""Ajoute le champ `image` (og:image de la fiche) a data/moules-guy-demarle.json.
Requetes espacees de 2 s (le site est protege par Cloudflare et bloque les rafales)."""
import json,re,subprocess,time,os
p=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/data/moules-guy-demarle.json'
d=json.load(open(p))
for m in d['moules']:
    if m.get('image'): continue
    for _ in range(3):
        h=subprocess.run(['curl','-s','-L','-A','Mozilla/5.0',m['url']],capture_output=True,text=True).stdout
        g=re.search(r'<meta property="og:image" content="([^"]*)"',h)
        if g: m['image']=g.group(1); break
        time.sleep(5)
    print(m['id'],bool(m.get('image')),flush=True); time.sleep(2)
    json.dump(d,open(p,'w'),ensure_ascii=False,indent=1)
