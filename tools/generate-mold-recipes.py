"""Genere les recettes de recettes/ pour chaque moule de data/moules-guy-demarle.json.

Les recettes (titre, ingredients, etapes) sont ecrites a la main dans tools/mold-recipes/*.py,
sous forme de dictionnaire M[<id moule>] = [R(...), ...].
Ce script adapte les quantites a la contenance du moule, calcule le temps de cuisson
selon la taille d'une empreinte et ecrit un fichier JSON par recette.

Usage : python3 tools/fetch-mold-images.py  (une fois, pour les photos)  puis  python3 tools/generate-mold-recipes.py
"""
import json,re,math,glob,os,sys,unicodedata
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/'
moulds={m['id']:m for m in json.load(open(ROOT+'data/moules-guy-demarle.json'))['moules']}
import subprocess
tracked=set(subprocess.run(['git','-C',ROOT,'ls-files','recettes'],capture_output=True,text=True).stdout.split())
existing=set(); mold_by_url={}
for f in glob.glob(ROOT+'recettes/*.json'):
    if 'recettes/'+os.path.basename(f) in tracked: existing.add(os.path.basename(f)[:-5])
    try:
        m=json.load(open(f)).get('mold') or {}
        if m.get('url') and m.get('picture') and not m['picture'].startswith(('https://anneetsesdelices','http://localhost')): mold_by_url.setdefault(m['url'],m)
    except Exception: pass
ref=json.load(open(ROOT+'recettes/5-cakes-marbres.json'))
ACC=[next(a for a in ref['accessories'] if a['name'].startswith(n)) for n in ('Balance','Grand cul','Support','Fouet','Plaque')]
# ---- types de preparation : fill=taux de remplissage, dens=g/ml, tmp=temperature, tm=coef. temps de cuisson, cold=pas de four
TYPES={'g':dict(fill=.72,dens=1.0,tmp=170,tm=1.0),'f':dict(fill=.65,dens=1.1,tmp=170,tm=.85),'m':dict(fill=.75,dens=1.0,tmp=180,tm=1.0),
 's':dict(fill=.70,dens=1.0,tmp=180,tm=1.0),'c':dict(fill=.88,dens=1.03,tmp=150,tm=1.2),'p':dict(fill=.55,dens=.95,tmp=180,tm=1.0),
 'b':dict(fill=.80,dens=1.0,tmp=180,tm=.8),'i':dict(fill=.92,dens=1.0,cold=True),'e':dict(fill=.90,dens=1.0,cold=True)}
W={'g':1,'cl':10,'cs':15,'cc':5,'œufs':50,'jaunes':20,'blancs':30,'sachet':11,'pincée':0,'u':100}
M={}
def R(title,t,ing,steps,**kw): return dict(title=title,t=t,ing=ing,steps=steps,**kw)
for p in sorted(glob.glob(ROOT+'tools/mold-recipes/*.py')): exec(open(p,encoding='utf8').read(),{'M':M,'R':R})
def fold(s): return re.sub(r'[^a-z0-9]+','-',unicodedata.normalize('NFKD',s.lower()).encode('ascii','ignore').decode()).strip('-')
def frac(x,step=.5):
    x=round(x/step)*step; w=int(x); h=x-w
    return str(w) if h==0 else ('1/2' if w==0 else f'{w} 1/2')
def r5(v): return int(round(v/5)*5) if v>=12 else max(1,int(round(v)))
def parse(s):
    hid=s.startswith('*'); s=s.lstrip('*')
    q,rest=s.split('|',1) if '|' in s else (s,'')
    mm=re.match(r'([\d.,/ ]+?)\s*([a-zA-Zœé]*\d*)\s*$',q.strip()) if q.strip() else None
    qty=float(eval(mm.group(1).replace(',','.').replace(' ','+') if '/' in mm.group(1) else mm.group(1).replace(',','.'))) if mm else 0
    unit=mm.group(2) if mm else ''
    w=W.get(unit)
    if w is None and unit.startswith('u'): w=float(unit[1:]); unit='u'
    return dict(qty=qty,unit=unit,name=rest.strip() or q.strip(),hid=hid,w=w if w is not None else 50)
def fmt(i,k):
    v=i['qty']*k; u=i['unit']; n=i['name']
    if u=='œufs': return dict(quantity=frac(v),unit='Oeuf' if v<=1.01 else 'Oeufs',name='')
    if u=='jaunes': return dict(quantity=str(max(1,round(v))),unit="Jaunes d'oeufs",name='')
    if u=='blancs': return dict(quantity=str(max(1,round(v))),unit="Blancs d'oeufs",name='')
    if u=='sachet': return dict(quantity=frac(max(.5,v)),unit='sachet' if round(v*2)/2<=1 else 'sachets',name=n)
    if u=='cs': return dict(quantity=frac(max(.5,v)),unit='c-à-s',name=n)
    if u=='cc': return dict(quantity=frac(max(.5,v)),unit='c-à-c',name=n)
    if u=='cl': return dict(quantity=str(r5(v)),unit='cl',name=n)
    if u=='u': return dict(quantity=frac(max(.5,v)),unit='',name=n)
    if u=='pincée': return dict(quantity=str(i['qty']),unit='pincée' if i['qty']<=1 else 'pincées',name=n)
    if u!='g': return dict(quantity=frac(max(.5,v),.5),unit=u,name=n)
    return dict(quantity=str(r5(v)),unit='g',name=n)
def cook(c):
    for lim,r in [(3,(10,12)),(6,(12,15)),(10,(15,18)),(15,(18,22)),(25,(22,27)),(60,(28,33)),(120,(33,38)),(200,(38,45)),(300,(45,52))]:
        if c<=lim: return r
    return (50,60)
def est_cell(m):
    L,l,d,h=[m.get(k) for k in('empreinte_longueur_cm','empreinte_largeur_cm','empreinte_diametre_cm','empreinte_profondeur_cm')]
    n=lambda x:isinstance(x,(int,float))
    if n(h):
        if n(d): return math.pi*(d/2)**2*h*.7/10
        if n(L) and n(l): return L*l*h*.55/10
    return None
def capacity(m):
    nb=m['nb_empreintes'] if isinstance(m['nb_empreintes'],int) else 1
    cell,tot=m['contenance_empreinte_cl'],m['contenance_totale_cl']
    if 'incoherente' in (m.get('remarques') or ''): cell=tot=None
    if cell is None and tot is None: cell=est_cell(m)
    if cell is not None and (tot is None or nb>1): tot=cell*nb
    if tot is None: return None
    if cell is None or nb==1: cell=tot/nb
    return nb,cell,tot
def mold_obj(m):
    if m['url'] in mold_by_url: return mold_by_url[m['url']]
    return dict(name=re.sub(r'\s*-\s*Guy Demarle$','',m['nom']),picture=m.get('image',''),url=m['url'])
airfryer=lambda m: bool(re.search(r'(?i)air ?fryer|crispy',m['nom']))
cc=lambda v:('%g'%round(v,1)).replace('.',',')
n_written=0; used=set(); missing=[]
for mid,recs in M.items():
    m=moulds[mid]; cap=capacity(m)
    if not cap: missing.append(m['nom']); continue
    nb,cell,tot=cap
    for r in recs:
        T=dict(TYPES[r['t']]); T.update({k:r[k] for k in('fill','tmp','tm') if k in r})
        ing=[parse(s) for s in r['ing']]
        k0=sum(i['qty']*i['w'] for i in ing if not i['hid'])
        k=tot*10*T['fill']*T['dens']/k0
        for u,step in (('œufs',.5),('jaunes',1),('blancs',1)):
            e=[i for i in ing if i['unit']==u]
            if e: k=max(step,round(k*e[0]['qty']/step)*step)/e[0]['qty']; break
        batter=k*k0; gper=r5(batter/nb) if nb>1 else None
        af=airfryer(m); steps=[]
        fillstep=(f"Répartir la préparation dans les {nb} empreintes (environ {gper} g par empreinte ; chaque empreinte contient {cc(cell)} cl)." if nb>1
                  else f"Verser la préparation dans le moule (environ {r5(batter)} g ; le moule contient {cc(tot)} cl).")
        body=list(r['steps'])
        if '{FILL}' not in body: body.append('{FILL}')
        i=body.index('{FILL}'); pre,post=body[:i],body[i+1:]
        cold=T.get('cold'); delayed=(not cold) and (r.get('rest') or r['t']=='p')
        plaque="Poser votre moule sur la grille du panier de l'airfryer." if af else "Poser votre moule sur une plaque aluminium perforée."
        if cold: steps=["Poser votre moule sur une plaque aluminium perforée (elle facilitera le passage au froid)."]+pre+[fillstep]+post
        else:
            tmp=T['tmp']-(10 if af else 0)
            heat=f"Préchauffer votre {'airfryer' if af else 'four'} à {tmp}°C."
            if delayed:
                steps=pre+[plaque,fillstep]+post+(["Laisser lever encore 30 min à température ambiante."] if r['t']=='p' else [])+[heat]
            else: steps=[heat,plaque]+pre+[fillstep]+post
        if not T.get('cold'):
            if r['t']!='p' and not r.get('notap'): steps.append("Taper le moule sur le plan de travail pour égaliser la pâte." if af else "Taper la plaque sur le plan de travail pour égaliser la pâte.")
            a,b=cook(cell); a=round(a*T['tm']*r.get('ct',1)); b=round(b*T['tm']*r.get('ct',1))
            steps.append(f"{'Cuire' if af else 'Enfourner'} à {tmp}°C pendant {a}-{b} min (suivant votre {'appareil' if af else 'four'}).")
            steps.append(r.get('cool',"Laisser refroidir avant de démouler."))
            cooktime=f'{a}-{b}'; rest=r.get('rest','0')
        else:
            steps.append(f"Placer au {r.get('cold','congélateur')} pendant au moins {r.get('rest','6h')}.")
            steps.append(r.get('cool',"Démouler en poussant doucement depuis le dessous du moule silicone."))
            cooktime='0'; rest=r.get('rest','6h')
        steps=[f'{n}. {s}' for n,s in enumerate(steps,1)]
        slug=fold(r['title'])
        if slug in existing or slug in used: slug+='-'+mid
        used.add(slug)
        out=dict(title=r['title'],slug=slug,private=False,draft=False,toppings=[fmt(i,k) for i in ing],accessories=ACC,steps='\n'.join(steps),
                 **{'for':str(nb if nb>1 else max(1,round(batter/100)))},preptime=str(r.get('prep',15)),resttime=rest,cooktime=cooktime,cover='',gallery=[],mold=mold_obj(m))
        json.dump(out,open(ROOT+f'recettes/{slug}.json','w'),ensure_ascii=False,indent=4); n_written+=1
print(n_written,'recettes ecrites;',len(M),'moules;','sans contenance:',missing)
