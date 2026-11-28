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
existing=set(); mold_by_url={}; by_title={}
for f in glob.glob(ROOT+'recettes/*.json'):
    if 'recettes/'+os.path.basename(f) in tracked: existing.add(os.path.basename(f)[:-5])
    try: j=json.load(open(f)); by_title[j['title']]=(f,j)
    except Exception: pass
    try:
        m=json.load(open(f)).get('mold') or {}
        if m.get('url') and m.get('picture') and not m['picture'].startswith(('https://anneetsesdelices','http://localhost')): mold_by_url.setdefault(m['url'],m)
    except Exception: pass
ref=json.load(open(ROOT+'recettes/5-cakes-marbres.json'))
ACC=[next(a for a in ref['accessories'] if a['name'].startswith(n)) for n in ('Balance','Grand cul','Support','Fouet','Plaque')]
# ---- types de preparation
# fill = grammes de preparation crue par ml de contenance.
# g, m, s, f, b, c, p : cales sur les medianes des recettes verifiees du depot (celles hors brouillon).
# i, e (froid) et cannelles : pas de reference verifiee fiable, regle generale.
TYPES={'g':dict(fill=.64,tmp=170,tm=1.0),   # gateau
 'f':dict(fill=.65,tmp=170,tm=.85),         # fondant, brownie
 'm':dict(fill=.64,tmp=180,tm=1.0),         # muffin
 's':dict(fill=.68,tmp=180,tm=1.0),         # cake sale
 'c':dict(fill=.80,tmp=150,tm=1.2),         # flan, quiche, cheesecake
 'p':dict(fill=.55,tmp=180,tm=1.0),         # pate levee
 'b':dict(fill=.65,tmp=180,tm=.8),          # financier, pate aux amandes
 'i':dict(fill=1.0,cold=True),'e':dict(fill=1.0,cold=True)}
AERE=.72   # mousse / glace avec creme montee : 1 g occupe environ 1,4 ml
def target(r,T,ing):
    title=r['title'].lower(); txt=' '.join(r['steps']).lower()
    if r['title'] in FILL: return FILL[r['title']]
    if r['t'] in('i','e'): return AERE if ('chantilly' in txt or 'meringu' in title and False) else 1.0
    if title.startswith(('cannelés','mini cannelés')): return .95
    if 'madeleine' in title: return .78
    if r['t']=='g' and not any(i['unit']=='sachet' or 'Levure' in i['name'] for i in ing): return TYPES['f']['fill']
    return T['fill']
# cas particuliers ou la preparation n'a pas vocation a remplir tout le volume
FILL={"Focaccia aux tomates cerises et au romarin":.42,"Pizza épaisse à l'airfryer chorizo-mozzarella":.40,"Cookie géant aux pépites à l'airfryer":.45,
 "Mini tartelettes citron meringuées":.55,"Mini tartelettes chocolat-caramel":.55,"Mini tartelettes salées chèvre-miel":.55}
# ingredients places DANS l'empreinte et non melanges a la pate : coefficient de volume apres cuisson
INSIDE={'tatins-individuelles':{'Pommes':.6},'tartes-renversees-chevre':{'Tomates':.7},'tartes-renversees-ananas':{'Ananas':.8},
 'tarte-renversee-poires':{'Poires':.7},'tarte-renversee-aux-oignons':{'Oignons':.35},'tarte-renversee-abricots':{'Abricots':.7},
 'tarte-renversee-aux-legumes':{'Courgette':.45,'Poivron':.45,'Aubergine':.4},'tatin-rectangulaire':{'Pommes':.6,'Poires':.6},
 'gateau-renverse-aux-prunes':{'Prunes':.7},'cheesecakes-cuits':{'Spéculoos':.9},'cheesecake-cuit-au-citron':{'Biscuits':.9},
 'gateau-basque':{'Crème pâtissière':1.0},'barquettes-aux-poires':{'Poires':.8},'barquettes-chocolat-framboise':{'Framboises':.8},
 'coeurs-fondants-framboise':{'Framboises':.8},'coeurs-de-pain-perdu':{'Brioche':.6},'coeur-origami-de-pain-perdu':{'Brioche':.6,'Fruits':.7},
 'coeurs-surprise-au-praline':{'Praliné':.9},'coeurs-surprise-framboise':{'Confiture':.9},'coeurs-surprise-sales':{'Fromage':.9},
 'muffins-droits-pommes':{'Caramel':.9},'muffins-pommes-cannelle':{'Farine':.8,'Beurre':.8,'Sucre':.8},
 'brioches-longues-a-la-creme':{'Crème pâtissière':.9,'Pépites':.9},'petites-charlottes-aux-fraises':{'Biscuits':1.0},
 'petits-pains-xxx':{}}
# contenances corrigees (cl par empreinte, nombre) : fiche du site absente ou manifestement fausse
CAPACITY={'8555':(12,9),      # fiche : 90 cl par pain pour 12,7 x 4,7 x 2 cm -> 90 ml
 '8728':(3,52),               # fiche : 52 cl pour une baguette de 35 x 7,4 x 3 cm (pas pour les trois)
 '4364':(1,130),              # moule a cake 24,5 x 9,3 x 7 cm, contenance estimee
 '8277':(1,125)}              # layer cake diametre 17, hauteur 6 cm, contenance estimee
# poids en grammes d'une unite
W={'g':1,'cl':10,'cs':15,'cc':5,'œufs':50,'jaunes':20,'blancs':30,'sachet':11,'pincée':0,'u':100,'gouttes':0.05,'tranches':30}
def unit_weight(unit,name,w):
    n=name.lower()
    if unit=='u' and w==100:
        for pat,g in [('citrons verts (zeste)',2),('(zeste)',4),('citron vert (zeste et jus)',30),('citrons verts (zeste et jus)',30),('citrons verts (jus)',30),
                      ('orange (zeste et jus)',90),('citron',45),('gousse',5),('échalote',30),('pomme',150),('poire',150),('courgette',200),('poivron',150),
                      ('aubergine',250),('oignon',110),('blancs de poireaux',100)]:
            if pat in n: return g
    if unit in('cs','cc'):
        f=1 if unit=='cs' else 1/3
        for pat,g in [('ciselé',4),('romarin',3),('thym',3),('herbes',3),('aneth',3),('origan',3),('basilic',3),('persil',4),('graines',10),
                      ('cacao',7),('matcha',6),('épices',6),('cannelle',6),('paprika',6),('cumin',6),('gingembre',6),('pesto',16),('miel',20),('maïzena',9)]:
            if pat in n: return g*f
    return w
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
    name=rest.strip() or q.strip()
    return dict(qty=qty,unit=unit,name=name,hid=hid,w=unit_weight(unit,name,w if w is not None else 50))
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
    if u=='pincée': return dict(quantity='%g'%i['qty'],unit='pincée' if i['qty']<=1 else 'pincées',name=n)
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
    if m['id'] in CAPACITY:
        nb,cell=CAPACITY[m['id']]; return nb,cell,nb*cell
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
        T=dict(TYPES[r['t']]); T.update({k:r[k] for k in('tmp','tm') if k in r})
        ing=[parse(s) for s in r['ing']]
        slug0=fold(r['title'])
        inside=next((v for k,v in INSIDE.items() if slug0.startswith(k)),{})
        for i in ing:
            i['inside']=next((c for n,c in inside.items() if i['hid'] and i['name'].startswith(n)),0)
        k0=sum(i['qty']*i['w'] for i in ing if not i['hid'])
        kin=sum(i['qty']*i['w']*i['inside'] for i in ing)
        fill=target(r,T,ing)
        k=tot*10*fill/(k0+kin*fill)
        batter=k*k0; gper=(round(batter/nb) if batter/nb<30 else r5(batter/nb)) if nb>1 else None
        toppings=[fmt(i,k) for i in ing]
        flour=sum(i['qty']*k*i['w'] for i in ing if not i['hid'] and i['name'].startswith(('Farine','Poudre d','Noix de coco','Polenta')))
        for x,i in enumerate(ing):
            if i['unit']=='sachet' and flour:
                grams=min(i['qty']*k*11,.045*flour); half=round(grams/5.5)/2
                if half and abs(half*11-grams)<=.1*grams: toppings[x]=dict(quantity=frac(half),unit='sachet' if half<=1 else 'sachets',name=i['name'])
                else: toppings[x]=dict(quantity=str(max(1,round(grams))),unit='g',name=i['name'])
        extra_step=None
        e=next((x for x,i in enumerate(ing) if i['unit']=='œufs'),None)
        if e is not None:
            exact=ing[e]['qty']*k
            liq=next((x for x,i in enumerate(ing) if not i['hid'] and i['unit'] in('g','cl') and re.match(r'(Lait|Crème liquide|Yaourt|Eau|Fromage blanc)',i['name'])),None)
            have=ing[liq]['qty']*k*ing[liq]['w'] if liq is not None else 0
            if exact<.75 and not T.get('cold'):
                toppings[e]=dict(quantity=str(r5(exact*50)),unit='g',name='Oeuf battu (une partie d\'un oeuf)')
            else:
                n=max(1,round(exact)); diff=(exact-n)*50   # >0 : il manque du liquide
                if diff<0 and have+diff<=0 and int(exact)>=1: n=int(exact); diff=(exact-n)*50
                toppings[e]=dict(quantity=str(n),unit='Oeuf' if n==1 else 'Oeufs',name='')
                if abs(diff)>=8 and not r.get('notap'):
                    if liq is not None and have+diff>0:
                        toppings[liq]['quantity']=str(r5((have+diff)/ing[liq]['w']))
                    elif diff>0:
                        liquid='Crème liquide' if r['t']=='f' else 'Lait'
                        toppings.append(dict(quantity=str(r5(diff)),unit='g',name=liquid))
                        extra_step=f"Ajouter {'la crème' if r['t']=='f' else 'le lait'} et mélanger."
        af=airfryer(m); steps=[]
        fillstep=(f"Répartir la préparation dans les {nb} empreintes (environ {gper} g par empreinte ; chaque empreinte contient {cc(cell)} cl)." if nb>1
                  else f"Verser la préparation dans le moule (environ {r5(batter)} g ; le moule contient {cc(tot)} cl).")
        body=list(r['steps'])
        if '{FILL}' not in body: body.append('{FILL}')
        if extra_step: body.insert(body.index('{FILL}'),extra_step)
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
            where=r.get('cold','congélateur')
            if where=='réfrigérateur' and not any('Gélatine' in i['name'] for i in ing): where='congélateur'
            steps.append(f"Placer au {where} pendant au moins {r.get('rest','6h')}.")
            steps.append(r.get('cool',"Démouler en poussant doucement depuis le dessous du moule silicone."))
            cooktime='0'; rest=r.get('rest','6h')
        steps=[f'{n}. {s}' for n,s in enumerate(steps,1)]
        portions=str(nb if nb>1 else max(1,round(batter/100)))
        data=dict(toppings=toppings,steps='\n'.join(steps),**{'for':portions},cooktime=cooktime)
        old=by_title.get(r['title'])
        if old and old[1].get('draft') is not True: print('verifiee, non modifiee :',r['title']); continue
        if old:
            path,out=old; out.update(data)
        else:
            slug=fold(r['title'])
            if slug in existing or slug in used: slug+='-'+mid
            used.add(slug); path=ROOT+f'recettes/{slug}.json'
            out=dict(title=r['title'],slug=slug,private=False,draft=True,accessories=ACC,preptime=str(r.get('prep',15)),resttime=rest,cover='',gallery=[],mold=mold_obj(m),**data)
        json.dump(out,open(path,'w'),ensure_ascii=False,indent=4); n_written+=1
print(n_written,'recettes ecrites;',len(M),'moules;','sans contenance:',missing)
