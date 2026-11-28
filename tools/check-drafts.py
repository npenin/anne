"""Verifie que les recettes generees pour les moules sont bien en brouillon ("draft": true).

Convention du depot : une recette hors brouillon a ete realisee et verifiee en cuisine.
Recettes concernees, jamais testees : celles de tools/mold-recipes/*.py et les 3 premieres,
ecrites avant le generateur.
Ne modifie rien. Code de sortie 1 si une recette est manquante ou n'est pas en brouillon.

Usage : python3 tools/check-drafts.py
"""
import glob,json,os,sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M={}
for p in glob.glob(ROOT+'/tools/mold-recipes/*.py'):
    exec(open(p,encoding='utf8').read(),{'M':M,'R':lambda title,*a,**k:title})
expected={t for titles in M.values() for t in titles}
FIRST={'petits-chalets-fondants-chocolat-noisette','twists-orange-chocolat','muffins-myrtilles'}

found,not_draft,first_found=set(),[],set()
for f in sorted(glob.glob(ROOT+'/recettes/*.json')):
    r=json.load(open(f,encoding='utf8'))
    slug=os.path.basename(f)[:-5]
    if r.get('title') in expected: found.add(r['title'])
    elif slug in FIRST: first_found.add(slug)
    else: continue
    if r.get('draft') is not True: not_draft.append((os.path.relpath(f,ROOT),r.get('draft')))

missing=sorted(expected-found)+sorted(FIRST-first_found)
total=len(found)+len(first_found)
print(f"{total} recettes verifiees, {total-len(not_draft)} en brouillon, {len(not_draft)} pas en brouillon, {len(missing)} introuvables")
for f,v in not_draft: print(f"  pas en brouillon : {f} (draft={v!r})")
for t in missing: print(f"  introuvable : {t}")
sys.exit(1 if not_draft or missing else 0)
