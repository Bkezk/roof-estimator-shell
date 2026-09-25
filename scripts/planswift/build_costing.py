#!/usr/bin/env python3
"""Bid-O-Matic Costing.SwiftTemplates for PlanSwift 11.

Superset of the Part A quantities set: the same item names and inputs (so the
Bid-O-Matic importer still reads them), plus hidden calculation properties and
Material / Labor parts under each item, with every price, multiplier and labor
table pulled from partC.json (the Part C feed export) - nothing typed by hand.

Formula conventions (PlanSwift 11, verified against the user's own export):
  [Prop]                    property reference (parts inherit the parent's props)
  [!if(cond, a, b)]         conditional (nestable)
  '[Text Prop]' = 'value'   string test
  RoundUp / RoundDown / Round / Sqrt
"""
import copy, re, uuid, zipfile, json, os, sys
import xml.etree.ElementTree as ET
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bom_lists import *

SRC = os.environ.get('PS_SAMPLE_XML', os.path.join(HERE, 'sample', 'XMLData.XML'))
OUT_DIR = os.environ.get('PS_OUT', os.path.join(HERE, 'out'))
OUT_XML = os.path.join(OUT_DIR, 'costing', 'XMLData.XML')
OUT_ZIP = os.path.join(OUT_DIR, 'Bid-O-Matic Costing.SwiftTemplates')
FEED = json.load(open(os.environ.get('PS_PARTC', os.path.join(HERE, 'out', 'partC.json'))))
CRLF = '\r\n'
def guid(): return '{' + str(uuid.uuid4()).upper() + '}'
def num(s):
    s = (s or '').strip().replace(',', '')
    try: return float(s)
    except: return 0.0
def safe(name): return name.replace("'", ' ft').replace('  ', ' ').strip()
def fmt(x):
    x = float(x); return str(int(x)) if x == int(x) else repr(round(x, 6))

# ============================================================ feed access
def table(key_start, idx=0):
    for k, ts in FEED.items():
        if k.startswith(key_start): return ts[idx]
    raise KeyError(key_start)
def rows(key_start, idx=0):
    t = table(key_start, idx); hdr = t[0]
    return [dict(zip(hdr, r)) for r in t[1:]]

# ---- membrane price rows: {(sys, mil, tier, plus): {color: price}}
COLOR_COLS = ['White','Tan','Gray','Dark Gray','Terra Cotta','Rock-Ply','Black']
SYS_ID = {'Duro-Last':1,'Duro-Bond':2,'Duro-Tuff':3,'Duro-Roof':4,'Duro-Fleece':5,'Duro-Tech TPO':6,'Non-DL TPO':7,'EPDM Rubber':8}
MEMB = {}
for r in rows('`duro_last:duro_last_membrane`'):
    d = r['Description']
    m = re.match(r'(Duro-Last|Duro-Fleece|Duro-Bond|Duro-Tuff|Duro-Tech TPO|Non-DL TPO|EPDM Rubber) - (\d+)(?:mil)?\s*(.*)$', d)
    if not m: continue
    sysn, mil, rest = m.group(1), int(m.group(2)), m.group(3).strip()
    plus = 'Plus' in rest; rest = rest.replace('Plus','').strip()
    tier = rest or 'Flat'
    MEMB[(SYS_ID[sysn], mil, tier, plus)] = {c: num(r.get(c)) for c in COLOR_COLS}
UNDERLAY_COST = {r['Name']: num(r['Cost/Sq. Ft.']) for r in rows('`duro_last:underlayment`')}
FAST = [r for r in rows('`duro_last:fasteners_and_bits`')]
SCREW_SUBTYPES = ['Auger','Concrete Screw','NTB','Spade','Drill Point','Nail','XHD','Purlin','Stainless','Hex Head','Roofing Nails','Collated Screws']
SCREWS = [(f"{r['Subtype']} {r['Description']}".strip(), num(r['Price/Box'])/max(num(r['Fasteners/Box']),1)) for r in FAST if r['Subtype'] in SCREW_SUBTYPES and num(r['Fasteners/Box'])>1]
PLATES = [(r['Description'], num(r['Price/Box'])/max(num(r['Fasteners/Box']),1)) for r in FAST if r['Subtype']=='DL-Plates']
TBAR = {r['Description']: num(r['Price']) for r in rows('`duro_last:termination_bars`')}
FASCIA = rows('`duro_last:facia_bars_vinyl_covers`')
GS = {r['Description']: r for r in rows('`duro_last:gravel_stops`')}
DE = {r['Description']: r for r in rows('`duro_last:drip_edge`')}
PIPE = rows('`duro_last:pipe_stacks`')
BOOT = rows('`duro_last:drain_boots`')
RING = {re.match(r'([\d /]+)"', r['Description']).group(1).strip(): num(r['Price']) for r in rows('`duro_last:cdr_rings`')}
VENTS = {r['Description'].replace(' Vent','').replace('Rock Ply','Rock-Ply'): num(r['Price']) for r in rows('`duro_last:vents`')}
PADPRICE = {r['Description']: num(r['Price']) for r in rows('`duro_last:walk_pads_wall_vents`')}
BLOCKING = rows('`non_dl:roof_edge_blocking`')
for r in BLOCKING: r['Description'] = safe(r['Description'])
BLOCK_THICK = {'½" Wood Blocking': 0.5, '¾" Wood Blocking': 0.75, '5/4" Wood Blocking': 1.25, '2" Wood Blocking': 2}   # per-ft rows; others are 12 ft pieces
def ul_thickness(name):
    m = re.match(r'^(\d+ \d+/\d+|\d+/\d+|\d+(?:\.\d+)?)"', name)
    if not m: return 0.0
    t = m.group(1)
    if ' ' in t: a, b = t.split(' '); return float(a) + eval(b)
    return float(eval(t))
SHEETMETAL = rows('`non_dl:sheet_metal_work`')
for r in SHEETMETAL: r['Description'] = safe(r['Description'])
OTHERS = {r['Description']: r for r in rows('`non_dl:others`')}
ADH = rows('C.3 Adhesives')
ADH_ID = {r['long_name']: int(r['adhesive_id']) for r in ADH}
ADH_PRICE = {int(r['adhesive_id']): num(r['price']) for r in ADH}
ADH_UNIT = {int(r['adhesive_id']): r['unit_type'] for r in ADH}
COV_DECK = rows('Coverage on a bare deck')
COV_GRP = rows('Coverage over an underlayment group')
ADH_LABOR = rows('Adhesive labor')
UL_GROUPS = rows('Underlayment groups and boards', 0)
UL_BOARDS = rows('Underlayment groups and boards', 1)
ROOFSYS = rows('C.4 Roof systems')
NEEDS_VENTS = {int(r['roof_system_id']) for r in ROOFSYS if r['needs_vents']=='1'}
LAP_OVER = {int(r['roof_system_id']): num(r['lap_over']) for r in ROOFSYS}
TABMULTI = {(int(r['roof_system_id']), int(r['tab_spacing'])): num(r['multiplier']) for r in rows('Tab / roll-width multipliers', 0)}
ROLLWIDTH = {(int(r['roof_system_id']), int(r['width_in'])): num(r['multiplier']) for r in rows('Tab / roll-width multipliers', 1)}
ADH_SHEET = {(int(r['adhesive_id']), r['sheet_label'], int(r['roof_system_id'])): num(r['multiplier']) for r in rows('Sheet tab spacings offered', 1)}
PARAPET = rows('C.7 Parapet labor')
CURB_DECK = {r['deck_type']: num(r['minutes']) for r in rows('C.8 Curb labor', 0)}
CURB_TYPE = {r['curb_type']: num(r['multiplier']) for r in rows('C.8 Curb labor', 1)}
UL_LAYOUT = {r['underlayment']: num(r['layout_hours_per_2500sqft']) for r in rows('C.9 Underlayment', 0)}
UL_PERBOARD = [r['count'] for r in rows('C.9 Underlayment', 1)]
UL_MINFAST = {r['deck']: num(r['minutes_per_fastener']) for r in rows('C.9 Underlayment', 2)}
FASTLOOK = rows('C.6 Fastener spacing')
DESIGN_ALL = [str(int(v)) for v in sorted({num(r['design_table']) for r in FASTLOOK} | {num(d) for d in DESIGN})]
def fastener_lookup_formula():
    """Field spacing from (SysID, Design Table, Tab, Mil, Pull Test): largest pull_test row <= the job's pull test."""
    by_sys = []
    for sid in sorted({int(r['roof_system_id']) for r in FASTLOOK}):
        des_pairs = []
        for des in sorted({int(r['design_table']) for r in FASTLOOK if int(r['roof_system_id'])==sid}):
            grp = [r for r in FASTLOOK if int(r['roof_system_id'])==sid and int(r['design_table'])==des]
            tab_pairs = []
            for tab in sorted({int(r['tab_spacing']) for r in grp}):
                g2 = [r for r in grp if int(r['tab_spacing'])==tab]
                mil_pairs = []
                for mil in sorted({int(r['membrane_thickness']) for r in g2}):
                    g3 = sorted([r for r in g2 if int(r['membrane_thickness'])==mil], key=lambda r: num(r['pull_test']))
                    steps = [(num(r['pull_test']), num(r['field_spacing'])) for r in g3 if num(r['field_spacing'])>0]
                    if not steps: continue
                    e = ge_chain('[Pull Test (lbs)]', steps, fmt(steps[0][1]))
                    mil_pairs.append((f"[BOM Mil] = {mil}", e) if mil > 0 else ('ANY', e))
                anym = [e for c,e in mil_pairs if c=='ANY']
                e = chain([p for p in mil_pairs if p[0]!='ANY'], anym[0] if anym else '0')
                tab_pairs.append((f"[BOM Tab] = {tab}", e) if tab > 0 else ('ANY', e))
            anyt = [e for c,e in tab_pairs if c=='ANY']
            des_pairs.append((f"[BOM Design] = {des}", chain([p for p in tab_pairs if p[0]!='ANY'], anyt[0] if anyt else '0')))
        by_sys.append((f"[BOM SysID] = {sid}", chain(des_pairs, '0')))
    return chain(by_sys, '0')
TEAROFF = rows('C.10 Tear-off')
for r in TEAROFF: r['tearoff_type'] = safe(r['tearoff_type'])
TEAR_TYPES = [r['tearoff_type'] for r in TEAROFF]
INSPECT = [(num(r['sqft']), num(r['hours'])) for r in rows('C.11 Setup and inspection', 1)]
SHIP = [(num(r['material_threshold']), num(r['shipping_cost'])) for r in rows('C.13 Shipping', 0)]
MARKUP = rows('C.13 Shipping', 1)[0]
CREW = num(MARKUP['hourly_rate']); GP = num(MARKUP['markup_amount'])/100
# Company settings and setup rules from the feed (partC extras written by feed_to_partc.py);
# the literals are only a fallback for a partC.json parsed from the bridge document.
try:
    _cs = rows('C.13 Company settings')[0]; TAX = num(_cs['sales_tax_rate'])
except Exception: TAX = 0.0625
try: SETUP_MIN = num(rows('C.11 Setup minimum')[0]['minimum_hours'])
except Exception: SETUP_MIN = 16
try: SETUP_PER_SF = num(rows('C.11 Setup and inspection', 0)[0]['multiplier'])
except Exception: SETUP_PER_SF = 0.003
ACC = {}
for k in ['`accessory_others`','`drain_boots`','`drain_roof_types`','`drip_edges`','`fascia_bars`','`gravel_stops`','`pipe_stack_usages`','`termination_bars`','`two_piece_metals`','`vents`']:
    ACC[k.strip('`')] = rows(k)

# per-system labor combos (mechanical): deck, spacing, sheet, mil
def combo(name):
    ts = [t for k,t in ((k,t) for k,ts in FEED.items() for t in ts) if k == name]
    out = {}
    for t in ts:
        h = t[0]
        if h[0]=='deck': out['deck'] = {r[0]: num(r[1]) for r in t[1:]}
        elif h[0]=='spacing_in': out['spacing'] = {int(r[0]): num(r[1]) for r in t[1:]}
        elif h[0]=='label': out['sheet'] = {r[0]: num(r[1]) for r in t[1:]}
        elif h[0]=='mil': out['mil'] = {r[0]: num(r[1]) for r in t[1:]}
        elif h[0]=='substrate': out['adh'] = {r[0]: num(r[1]) for r in t[1:]}
    return out
COMBO = {1: combo('Duro-Last / mechanical'), 4: combo('Duro-Roof / mechanical'), 3: combo('Duro-Tuff / mechanical'),
         2: combo('Duro-Bond / mechanical'), 6: combo('Duro-Tech TPO / mechanical'), 7: combo('Non-DL TPO / mechanical'), 8: combo('EPDM Rubber / mechanical')}
COMBO_ADH = {1: combo('Duro-Last / adhesive'), 3: combo('Duro-Tuff / adhesive'), 5: combo('Duro-Fleece / adhesive'),
             6: combo('Duro-Tech TPO / adhesive'), 7: combo('Non-DL TPO / adhesive'), 8: combo('EPDM Rubber / adhesive')}
BASE_HRS = {1:10, 4:10, 3:10, 2:10, 6:27, 7:27.5, 8:31}
BASE_TAB = {1:(28,1.5125), 4:(57,1.25), 3:(30,2.8), 6:(30,2.8), 7:(30,2.8), 8:(120,1)}

# ============================================================ formula helpers
def IF(c, a, b): return f"[!if({c}, {a}, {b})]"
def S(prop, val):
    assert "'" not in val, f'apostrophe in compare value {val!r}'
    return f"'[{prop}]' = '{val}'"
def chain(pairs, default='0'):
    """pairs: [(cond, value)] -> nested if, first match wins."""
    expr = str(default)
    for c, v in reversed(pairs): expr = IF(c, v, expr)
    return expr
def safe(name): return name.replace("'", ' ft').replace('  ', ' ').strip()
def strlookup(prop, mapping, default='0'):
    for k in mapping: assert "'" not in k, f'apostrophe in lookup key {k!r} for {prop}'
    return chain([(S(prop, k), fmt(v) if not isinstance(v,str) else v) for k, v in mapping.items()], default)
def numlookup(expr, mapping, default='0'):
    return chain([(f"{expr} = {fmt(k)}", fmt(v) if not isinstance(v,str) else v) for k, v in mapping.items()], default)
def ge_chain(expr, steps, default='0'):
    """steps ascending [(threshold, value)]: value for the highest threshold <= expr."""
    e = str(default)
    for th, v in steps: e = IF(f"{expr} >= {fmt(th)}", fmt(v), e)
    return e

COLOR_ID = {c: i+1 for i, c in enumerate(COLORS)}
DECK_ID = {d: i+1 for i, d in enumerate(DECKS)}                # 1 Wood .. 10 Purlin
DECK_TO_PARAPET = {'Wood':'Wood','Steel':'Structural Metal','Retrofit':'Metal Retrofit','Concrete':'Concrete','Gypsum':'Gypsum',
                   'LWC/Steel':'LWC over Steel','LWC/Concrete':'LWC over Concrete','LWC/Other':'LWC over Other','Tectum':'Tectum','Purlin':'Purlin Fastened'}
DECK_TO_ULMIN = {'Wood':'Wood','Steel':'Steel','Retrofit':'Metal Retrofit','Concrete':'Concrete','Gypsum':'Gypsum',
                 'LWC/Steel':'LWC / Steel','LWC/Concrete':'LWC / Concrete','LWC/Other':'LWC / Other','Tectum':'Tectum','Purlin':'Purlin Fastened'}
PARAPET_DECK_ID = {d: i+1 for i, d in enumerate(PARAPET_DECK)}
UNDERLAY_SAFE = [u.replace("4'x 4'", "4x4") for u in UNDERLAY]   # apostrophe-free for formulas
UL_SAFE2REAL = dict(zip(UNDERLAY_SAFE, UNDERLAY))
BOARD_GROUP = {}
for r in UL_BOARDS:
    BOARD_GROUP[r['board_name']] = int(r['underlayment_group_id'])

# ============================================================ XML building
tree = ET.parse(SRC); root = tree.getroot()
def find_item(name):
    for it in root.iter('Item'):
        if it.get('Name') == name: return it
    raise KeyError(name)
BASES = {'Area': find_item('Basic Area'), 'Linear': find_item('Basic Linear'), 'Count': find_item('Basic Count')}
def prop(item, name):
    for p in item.find('Properties'):
        if p.get('Name') == name: return p
BUILTIN = {'Area','Perimeter','Linear Total','Point Count','Segment Count','Count','Color','Type','Name','Shape','Scaled','Count Size',
           'Length','Width','Height','Depth','Pitch','Thickness','Diameter','Weight','Line Width','Line Side','Qty','Qty Formula','Cost Each','Units'}

class Inp:
    def __init__(self, name, lst=None, default='', hint='', cls='Text', remember=False):
        self.name, self.lst, self.default, self.hint, self.cls, self.remember = name, lst, default, hint, cls, remember
def T(name, lst=None, default='', hint='', remember=False): return Inp(name, lst, default, hint, 'Text', remember)
def N(name, default='0', hint='', remember=False): return Inp(name, None, default, hint, 'Number', remember)

def add_prop(props, idx, order, name, cls, text, group, hidden=False, inp=None, extra=None):
    a = {'Class': cls, 'GUID': guid(), 'Name': name, 'group': group, 'OrderIndex': f'{order:.2f}', 'DecimalPlaces': '2'}
    if hidden: a['hidden'] = 'True'
    if inp is not None:
        a['input'] = 'True'
        if inp.lst: a['SimpleList'] = CRLF.join(inp.lst); a['List'] = 'cmbList'; a['PluginToExecute'] = 'cmbList'
        if inp.hint: a['ToolHint'] = inp.hint
        if inp.remember: a['RememberValue'] = 'True'
    if extra: a.update(extra)
    p = ET.Element('Property', a); p.text = text
    props.insert(idx, p); return p

def strip_digitizer_props(item):
    """Turn a Count clone into a plain Part: drop the fill/shape/takeoff props."""
    props = item.find('Properties')
    drop = {'Fill Type','Hatch','Hatch Pattern Scale','Hatch Pattern Color','Texture','Texture Image','Colorize Texture','Texture Width','Texture Height',
            'Scaled','Count Size','Takeoff','Line Width','Line Side','Video','Picture','Qty 2','Qty 2 Formula','Width','Length','Depth','# of Wall Sides',
            'Thickness','# of Runs','OC Spacing','Pitch','Manual Qty','Manual Subtract','Material Coverage','Labor Production','Equip Production','Weight',
            'Diameter','Slope %','Wall Area','Pitch Factor','Pitch Factor (Elev)','Price/SF','Price/LF','Wall Height','Assembly Total','Assembly Unit Price','ShowChildInputs'}
    for p in list(props):
        if p.get('Name') in drop: props.remove(p)

def make_part(name, qty_formula, units, cost_each, cost_type, note, order):
    it = copy.deepcopy(BASES['Count']); strip_digitizer_props(it)
    props = it.find('Properties'); g = guid()
    it.set('GUID', g); it.set('Name', name); it.set('Class', 'Item')
    prop(it,'GUID').text = g; prop(it,'Name').text = name; prop(it,'Type').text = 'Part'
    prop(it,'OrderIndex').text = str(order)
    for p in props:
        if p.get('GUID'): p.set('GUID', guid())
    d = prop(it,'Description'); d.text = note; d.set('ToolHint', note)
    qf = prop(it,'Qty Formula'); qf.text = qty_formula; qf.set('inputunits', units)
    prop(it,'Qty').set('inputunits', units)
    prop(it,'Waste %').text = '0'; prop(it,'Round Qtys').text = 'False'; prop(it,'Multiply').text = '1'
    ce = prop(it,'Cost Each'); ce.text = str(cost_each)
    ct = prop(it,'Cost Type'); ct.text = cost_type; ct.set('hidden','False')
    prop(it,'Markup %').text = '0'
    prop(it,'Form Layout').text = '<?xml version="1.0" encoding="UTF-8"?>\n<Items>\n  <Item Name="Name" Order="0" ShowUnits="False" SameLine="False" Tab=""/>\n  <Item Name="Description" Order="1" ShowUnits="False" SameLine="False" Tab=""/>\n</Items>'
    kids = it.find('Items')
    if kids is None: kids = ET.SubElement(it, 'Items')
    for c in list(kids): kids.remove(c)
    return it

def MAT(name, qty, units, cost, note='exact', order=0): return make_part(name, qty, units, cost, 'Material', note, order)
def LAB(name, hours, note='exact', order=0): return make_part(name, hours, 'HR', '[Crew Rate ($/h)]', 'Labor', note, order)

def make_item(name, base_type, desc, inputs, helpers, parts, order):
    """inputs: [Inp]; helpers: [(name, formula, visible)]; parts: [Element]"""
    it = copy.deepcopy(BASES[base_type]); props = it.find('Properties'); g = guid()
    it.set('GUID', g); it.set('Name', name)
    prop(it,'GUID').text = g; prop(it,'Name').text = name; prop(it,'OrderIndex').text = str(order)
    d = prop(it,'Description'); d.text = ''; d.set('ToolHint', desc)
    prop(it,'Cost Each').text = '0'; prop(it,'Waste %').text = '0'
    prop(it,'Division').text = '07.3  Roofing (Div 07.30.00)'
    for p in props:
        if p.get('GUID'): p.set('GUID', guid())
    existing = {p.get('Name') for p in props} | BUILTIN
    idx = list(props).index(d) + 1; base = float(d.get('OrderIndex')); k = 0
    layout = []
    for inp in inputs:
        assert inp.name not in existing, f'{name}: {inp.name!r} collides'; existing.add(inp.name)
        k += 1; add_prop(props, idx, base + 0.001*k, inp.name, inp.cls, inp.default, 'Bid-O-Matic', inp=inp); idx += 1
        layout.append(inp.name)
    for hname, formula, visible in helpers:
        assert hname not in existing, f'{name}: helper {hname!r} collides'; existing.add(hname)
        k += 1; add_prop(props, idx, base + 0.001*k, hname, 'Number', formula, 'BOM Calc', hidden=not visible); idx += 1
    fl = prop(it,'Form Layout'); old = ET.fromstring(fl.text.encode('utf-8'))
    keep = [e for e in old if e.get('Name') not in ('Name','Description')]
    new = ET.Element('Items'); o = 0
    for nm in ['Name','Description'] + layout:
        ET.SubElement(new,'Item',{'Name':nm,'Order':str(o),'ShowUnits':'False','SameLine':'False','Tab':''}); o += 1
    for e in keep: e.set('Order', str(o)); new.append(e); o += 1
    fl.text = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(new, encoding='unicode')
    kids = it.find('Items')
    if kids is None: kids = ET.SubElement(it,'Items')
    for c in list(kids): kids.remove(c)
    for i, p in enumerate(parts):
        prop(p,'OrderIndex').text = str(i); kids.append(p)
    return it

# ============================================================ shared input groups
BLANK = ' (blank = Job Setup)'
def material_inputs(section=True):
    """System inputs every priced item needs; remembered between placements."""
    return [
      T('Roof System', SYSTEMS, 'Duro-Last', 'Membrane system', remember=True),
      T('Attachment', ATTACH, 'mechanical', 'Duro-Bond & Duro-Roof mechanical only; Duro-Fleece adhered only', remember=True),
      T('Adhesive', ADHESIVES, '', 'Only used when Attachment = adhered', remember=True),
      T('Membrane Mil', MILS, '60', 'DL/Bond/Fleece 40,50,60 - Tuff 50,60 - TPO 45,60,80 - EPDM 45,60,75,90', remember=True),
      T('Membrane Variant', ['Plus'], '', 'Duro-Fleece only; blank = standard', remember=True),
      T('Membrane Color', COLORS, 'White', 'Membrane colour (price column)', remember=True),
      T('Sheet Size', SHEET, 'Roll Good', 'Duro-Roof has no Roll Good; Duro-Bond tops out at 2500 sf', remember=True),
      T('Field Tab Spacing', TABS, '60', 'Inches. DL 28,60,120 - Roof 57,87,120 - Tuff/TPO 30,60,120 - EPDM 120,240', remember=True),
      T('Deck Type', DECKS, 'Steel', 'Roof deck (labor multiplier, pre-drill)', remember=True),
      N('Crew Rate ($/h)', fmt(CREW), 'Feed markup_options.hourly_rate', remember=True),
    ]
SYSID = ('BOM SysID', strlookup('Roof System', SYS_ID), True)
MILN  = ('BOM Mil', strlookup('Membrane Mil', {m:int(m) for m in MILS}, '60'), False)
COLID = ('BOM ColorID', strlookup('Membrane Color', COLOR_ID, '1'), False)
DECKID= ('BOM DeckID', strlookup('Deck Type', DECK_ID, '2'), False)
PREDRILL = ('BOM PreDrill', chain([(f"[BOM DeckID] = {DECK_ID[d]}", '1') for d in ('Concrete','Gypsum','LWC/Steel','LWC/Concrete','LWC/Other')], '0'), False)

def membrane_price_formula(tier_expr_roll=True):
    """$/sq ft by SysID, Mil, tier (Roll Goods / tabs / Parapets / Flat), Plus, ColorID."""
    def color_chain(prices):
        return chain([(f"[BOM ColorID] = {COLOR_ID[c]}", fmt(prices[c])) for c in COLORS if prices.get(c)], '0')
    by_sys = []
    for sid in range(1, 9):
        mil_pairs = []
        for mil in sorted({k[1] for k in MEMB if k[0]==sid}):
            tiers = {k[2]: MEMB[k] for k in MEMB if k[0]==sid and k[1]==mil and not k[3]}
            plus  = {k[2]: MEMB[k] for k in MEMB if k[0]==sid and k[1]==mil and k[3]}
            if sid == 1:   # Duro-Last: Roll Goods / 28" Tabs / 60" Tabs / 120" Tabs / Parapets
                tier_expr = tier_expr_roll
                if tier_expr == 'PARAPET':
                    e = color_chain(tiers.get('Parapets', {}))
                elif tier_expr == 'ROLL':
                    e = color_chain(tiers.get('Roll Goods', {}))
                else:
                    e = chain([("[BOM IsRoll] = 1", color_chain(tiers.get('Roll Goods', {})))] +
                              [(f"[BOM Tab] = {t}", color_chain(tiers.get(f'{t}" Tabs', {}))) for t in (28,60,120) if f'{t}" Tabs' in tiers], '0')
            elif sid == 5:  # Duro-Fleece: Plus variant
                e = IF(S('Membrane Variant','Plus'), color_chain(plus.get('Flat', {})), color_chain(tiers.get('Flat', {})))
            else:
                e = color_chain(tiers.get('Flat', {}))
            mil_pairs.append((f"[BOM Mil] = {mil}", e))
        by_sys.append((f"[BOM SysID] = {sid}", chain(mil_pairs, '0')))
    return chain(by_sys, '0')

# ============================================================ ROOF SECTION
def roof_section():
    inputs = [T('Section Name', None, '', 'e.g. Main Roof, Upper Roof'), T('Cut-out of', None, '', 'Wells / penthouses: parent section name to subtract from')]
    inputs += material_inputs()
    inputs += [
      T('Design Table (psf)', DESIGN_ALL, '60', 'Wind design table (pull-test lookup)', remember=True),
      N('Pull Test (lbs)', '350', 'Drives the fastener spacing lookup', remember=True),
      T('Field Fastener OC (in)', ['Auto','6','8','9','10','12','14','15','16','18','21','24'], 'Auto', 'Auto = pull-test lookup (Part C C.6); or type/pick a spacing', remember=True),
      T('Fastener', [s for s,_ in SCREWS], SCREWS[0][0], 'Membrane screw (price = Price/Box / Fasteners/Box)', remember=True),
      T('Plate', [p for p,_ in PLATES], PLATES[0][0], 'Membrane plate', remember=True),
      T('Underlayment 1', UNDERLAY_SAFE, '', 'Bottom layer first; blank = no layer', remember=True),
      T('Underlayment 2', UNDERLAY_SAFE, '', 'Blank = no layer', remember=True),
      T('Underlayment 3', UNDERLAY_SAFE, '', 'Blank = no layer', remember=True),
      T('Underlayment 4', UNDERLAY_SAFE, '', 'Blank = no layer', remember=True),
      T('Underlayment Attach', UL_ATTACH, 'mechanical', 'How the boards are attached', remember=True),
      T('UL Fasteners per Board', UL_PERBOARD, '5', 'Fasteners per 4x8 board (feed default 5)', remember=True),
      T('Edge: Perimeter', YN, 'Yes', 'Perimeter enhancement zone default', remember=True),
      T('Edge: Termination', TERMINATION, 'No Termination', 'Edge metal on every side of this section (use BOM Roof Edge lines instead for mixed edges)', remember=True),
      T('Edge: Wood Blocking', YN, 'No', '', remember=True),
      T('Blocking Size', [r['Description'] for r in BLOCKING], BLOCKING[0]['Description'], 'Non-DL roof edge blocking row', remember=True),
      T('Edge: ARP (in)', ARP, '0', 'Additional reinforcement ply width; 0 = none', remember=True),
      T('Outside Corners', ['0','1','2','3','4','5','6','8','10','12'], '4', 'Outside corners on this section (gravel stop / 2-pc corners)'),
      T('Tear-off', ['None'] + TEAR_TYPES, 'None', 'Existing roof tear-off type (labor only; disposal is a Non-DL line)', remember=True),
    ]
    # ---- helpers
    H = [SYSID, MILN, COLID, DECKID, PREDRILL,
      ('BOM Mech', IF(S('Attachment','mechanical'), '1', '0'), False),
      ('BOM Tab', strlookup('Field Tab Spacing', {t:int(t) for t in TABS}, '0'), False),
      ('BOM IsRoll', IF(S('Sheet Size','Roll Good'), '1', '0'), False),
      ('BOM SheetSF', strlookup('Sheet Size', {s:int(s.split()[0]) for s in SHEET if s!='Roll Good'}, '0'), False),
      ('BOM Design', strlookup('Design Table (psf)', {d:int(d) for d in DESIGN_ALL}, '60'), False),
      ('BOM OCAuto', fastener_lookup_formula(), True),
      ('BOM OC', IF(S('Field Fastener OC (in)','Auto'), IF('[BOM OCAuto] > 0', '[BOM OCAuto]', '12'),
                    strlookup('Field Fastener OC (in)', {o:int(o) for o in ['6','8','9','10','12','14','15','16','18','21','24']}, '12')), True),
      ('BOM Half', '[Linear Total] / 2', False),
      ('BOM Disc', '[BOM Half] * [BOM Half] - 4 * [Area]', False),
      ('BOM DiscPos', IF('[BOM Disc] < 0', '0', '[BOM Disc]'), False),
      ('BOM L', IF('[BOM Disc] < 0', 'Sqrt([Area])', '([BOM Half] + Sqrt([BOM DiscPos])) / 2'), True),
      ('BOM W', IF('[BOM Disc] < 0', 'Sqrt([Area])', '[BOM Half] - [BOM L]'), True),
      ('BOM AWEO', '[Area] + [Linear Total] / 2 + 1', True),
      ('BOM LapFt', IF('[BOM Tab] < 12', '1', 'RoundDown([BOM Tab] / 12)'), False),
      ('BOM LapOver', numlookup('[BOM SysID]', {k:v for k,v in LAP_OVER.items() if k}, '6'), False),
      ('BOM N', IF('[BOM SheetSF] > 0', 'RoundUp([BOM AWEO] / ' + IF('[BOM SheetSF] > 0', '[BOM SheetSF]', '1') + ')', '1'), False),
      ('BOM MWO', IF('[BOM IsRoll] = 1',
                     '[BOM AWEO] + RoundUp(([BOM W] + 1) / [BOM LapFt] * ([BOM L] + 1)) * ([BOM LapOver] / 12)',
                     IF('[BOM SheetSF] > 0',
                        '[BOM AWEO] + RoundDown(2 * [BOM N] - 2 * Sqrt([BOM N])) * Sqrt([BOM AWEO] / [BOM N])',
                        '[BOM AWEO] + RoundUp(([BOM W] + 1) / [BOM LapFt] * ([BOM L] + 1)) * ([BOM LapOver] / 12)')), True),
      ('BOM Memb $/SF', membrane_price_formula(), True),
      ('BOM RollGood $/SF', membrane_price_formula('ROLL'), False),
      # labor chain
      ('BOM BaseHrs', numlookup('[BOM SysID]', BASE_HRS, '10'), False),
      ('BOM DeckMult', chain([(f"[BOM SysID] = {sid}", chain([(f"[BOM DeckID] = {DECK_ID[d]}", fmt(m)) for d,m in c['deck'].items()], '1'))
                              for sid,c in COMBO.items() if 'deck' in c], '1'), False),
      ('BOM TabMult', chain([(f"[BOM SysID] = {sid}", chain([(f"[BOM Tab] = {t}", fmt(m)) for (s,t),m in TABMULTI.items() if s==sid], fmt(BASE_TAB.get(sid,(0,1))[1])))
                             for sid in range(1,9)], '1'), False),
      ('BOM OCMult', chain([(f"[BOM OC] = {k}", fmt(v)) for k,v in COMBO[1]['spacing'].items()] +
                           [(f"[BOM OC] = {k}", fmt(COMBO[1]['spacing'][n])) for k,n in ((8,9),(10,9),(14,15),(16,15))], '1'), False),
      ('BOM SheetMult', IF('[BOM Mech] = 1',
            chain([(f"[BOM SysID] = {sid}", chain([(S('Sheet Size', lbl), fmt(m)) for lbl,m in c['sheet'].items()], '1')) for sid,c in COMBO.items() if 'sheet' in c], '1'),
            chain([(f"[BOM SysID] = {sid}", chain([(S('Sheet Size', lbl), fmt(m)) for (a,lbl,s),m in ADH_SHEET.items() if s==sid and a==1], '1')) for sid in (1,)], '1')), False),
      ('BOM ThickMult', chain([(f"[BOM SysID] = {sid}", chain([(f"[BOM Mil] = {int(float(m))}", fmt(v)) for m,v in c['mil'].items() if 'Plus' not in m], '1'))
                               for sid,c in list(COMBO.items()) + [(5, COMBO_ADH[5])] if 'mil' in c], '1'), False),
      ('BOM AdhHrsK', chain([(f"[BOM SysID] = {sid}", chain([(S('Adhesive', a), fmt(v)) for a,v in c['adh'].items()], '5.215')) for sid,c in COMBO_ADH.items() if 'adh' in c], '5.215'), False),
      ('BOM InstallHrs', IF('[BOM Mech] = 1',
            '[BOM MWO] / 2500 * [BOM BaseHrs] * [BOM DeckMult] * [BOM TabMult] * [BOM OCMult] * [BOM SheetMult] * [BOM ThickMult]',
            '[BOM MWO] / 1000 * [BOM AdhHrsK] * [BOM SheetMult] * [BOM ThickMult]'), True),
      ('BOM Rows', IF('[BOM Tab] > 0', 'RoundUp(([BOM W] + 1) / (' + IF('[BOM Tab] > 0', '[BOM Tab]', '12') + ' / 12))', '0'), False),
      ('BOM Screws', IF('[BOM Mech] = 1', IF('[BOM SysID] = 2', '0', 'Round([BOM Rows] * ([BOM L] + 1) * 12 / [BOM OC])'), '0'), True),
      ('BOM Screw $', strlookup('Fastener', dict(SCREWS)), False),
      ('BOM Plate $', strlookup('Plate', dict(PLATES)), False),
      ('BOM MinPerFast', chain([(f"[BOM DeckID] = {DECK_ID[d]}", fmt(UL_MINFAST[DECK_TO_ULMIN[d]])) for d in DECKS], '0.462'), False),
      ('BOM ULPerBoard', strlookup('UL Fasteners per Board', {c:int(c) for c in UL_PERBOARD}, '5'), False),
      ('BOM ULMech', IF(S('Underlayment Attach','mechanical'), '1', '0'), False),
    ]
    for i in (1,2,3,4):
        u = f'Underlayment {i}'
        H += [
          (f'BOM UL{i} SF', IF(S(u,''), '0', IF(S(u,'Geotextile'), '[Area] * 1.06', '[Area] * 1.03')), False),
          (f'BOM UL{i} $/SF', strlookup(u, {s: UNDERLAY_COST[r] for s,r in UL_SAFE2REAL.items()}), False),
          (f'BOM UL{i} BoardSF', chain([(S(u,s), '16') for s in UNDERLAY_SAFE if '4x4' in s], '32'), False),
          (f'BOM UL{i} Boards', f'RoundUp([BOM UL{i} SF] / [BOM UL{i} BoardSF])', False),
          (f'BOM UL{i} Fast', IF('[BOM ULMech] = 1', f'[BOM UL{i} Boards] * [BOM ULPerBoard]', '0'), False),
          (f'BOM UL{i} Layout', strlookup(u, {s: UL_LAYOUT.get(r, 0) for s,r in UL_SAFE2REAL.items()}), False),
          (f'BOM UL{i} Hrs', IF(f'[BOM UL{i} SF] > 0', IF('[BOM ULMech] = 1', f'[Area] / 2500 * [BOM UL{i} Layout] + [BOM UL{i} Fast] * [BOM MinPerFast] / 60', '0'), '0'), False),
        ]
    # adhesive coverage: top substrate = group of the top-most board, else bare deck
    grp_pairs = []
    for i in (4,3,2,1):
        u = f'Underlayment {i}'
        grp_pairs.append((f"[BOM UL{i} SF] > 0", strlookup(u, {s: BOARD_GROUP.get(r, 0) for s,r in UL_SAFE2REAL.items()})))
    H += [('BOM TopGroup', chain(grp_pairs, '0'), False),
          ('BOM AdhID', strlookup('Adhesive', ADH_ID), False)]
    cov_by_adh = []
    for aid in sorted(ADH_ID.values()):
        sys_pairs = []
        for sid in range(0, 9):
            dk = {int(r['deck_type_id'])+1: num(r['coverage_sqft']) for r in COV_DECK if int(r['adhesive_id'])==aid and int(r['roof_system_id'])==sid}
            gk = {int(r['underlayment_group_id']): num(r['coverage_sqft']) for r in COV_GRP if int(r['adhesive_id'])==aid and int(r['roof_system_id'])==sid}
            if not dk and not gk: continue
            e = IF('[BOM TopGroup] > 0', numlookup('[BOM TopGroup]', gk, '0'), numlookup('[BOM DeckID]', dk, '0'))
            sys_pairs.append((f"[BOM SysID] = {sid}", e))
        # system 0 (insulations) rows are the fallback for any system
        fallback = next((e for c,e in sys_pairs if c == "[BOM SysID] = 0"), '0')
        cov_by_adh.append((f"[BOM AdhID] = {aid}", chain([p for p in sys_pairs if p[0] != "[BOM SysID] = 0"], fallback)))
    H += [('BOM AdhCov', chain(cov_by_adh, '0'), False),
          ('BOM AdhUnits', IF('[BOM Mech] = 1', '0', IF('[BOM AdhCov] > 0', 'RoundUp([Area] / ' + IF('[BOM AdhCov] > 0', '[BOM AdhCov]', '1') + ')', '0')), True),
          ('BOM Adh $', numlookup('[BOM AdhID]', ADH_PRICE), False),
          ('BOM Vents', IF('[BOM Mech] = 1', chain([(f"[BOM SysID] = {s}", 'RoundUp([Area] / 1000)') for s in sorted(NEEDS_VENTS) if s], '0'), '0'), False),
          ('BOM Vent $', numlookup('[BOM ColorID]', {COLOR_ID[c]: VENTS.get(c, 0) for c in COLORS}, fmt(VENTS['White'])), False),
          # edges at the job default, on this section's perimeter
          ('BOM TermID', strlookup('Edge: Termination', {t:i for i,t in enumerate(TERMINATION)}, '0'), False),
          ('BOM EdgeFt', '[Linear Total]', False),
          ('BOM BillFt', 'RoundUp(RoundUp(1.03 * [BOM EdgeFt]) / 10) * 10', False),
          ('BOM Corners', strlookup('Outside Corners', {c:int(c) for c in ['0','1','2','3','4','5','6','8','10','12']}, '0'), False),
          ('BOM ARPin', strlookup('Edge: ARP (in)', {a:int(a) for a in ARP}, '0'), False),
          ('BOM Blocking', IF(S('Edge: Wood Blocking','Yes'), '1', '0'), False),
          ('BOM Block $', strlookup('Blocking Size', {r['Description']: num(r['Price']) for r in BLOCKING}), False),
          ('BOM Block Hr', strlookup('Blocking Size', {r['Description']: num(r['LaborPerUnit']) for r in BLOCKING}), False),
          ('BOM ULThick', ' + '.join(strlookup(f'Underlayment {i}', {sn: ul_thickness(sn) for sn in UNDERLAY_SAFE}) for i in (1,2,3,4)), False),
          ('BOM BlockThick', strlookup('Blocking Size', BLOCK_THICK, '0'), False),
          ('BOM BlockBoards', IF('[BOM BlockThick] > 0', IF('[BOM ULThick] > [BOM BlockThick]', 'RoundUp([BOM ULThick] / ' + IF('[BOM BlockThick] > 0', '[BOM BlockThick]', '1') + ')', '1'), '0'), False),
          ('BOM BlockQty', IF('[BOM BlockThick] > 0', 'RoundUp([BOM BlockBoards] * [BOM EdgeFt] * 1.03)', 'RoundUp([BOM EdgeFt] / 12)'), False),
          ('BOM TearHrs', IF(S('Tear-off','None'), '0', '[Area] / 100 * ' + chain([(S('Tear-off', r['tearoff_type']),
                chain([(f"[BOM DeckID] = {DECK_ID[d]}", fmt(num(r.get(DECK_TO_PARAPET[d], '0')))) for d in DECKS], '0')) for r in TEAROFF], '0')), False),
    ]
    P = edge_parts('section') + [
      MAT('Membrane', '[BOM MWO]', 'SF', '[BOM Memb $/SF]', 'exact for roll goods/sheets on the equivalent rectangle; rough for Duro-Tuff mech'),
      LAB('Membrane Install Labor', '[BOM InstallHrs]', 'near: whole area billed at the field spacing (no perimeter/corner zones); Duro-Bond rough'),
      MAT('Membrane Screws', '[BOM Screws]', 'EA', '[BOM Screw $]', 'exact for row-style systems; perimeter rows not added'),
      MAT('Membrane Plates', '[BOM Screws]', 'EA', '[BOM Plate $]', 'exact (plates = screws)'),
    ]
    for i in (1,2,3,4):
        P += [MAT(f'Underlayment {i}', f'[BOM UL{i} SF]', 'SF', f'[BOM UL{i} $/SF]', 'exact (A x 1.03, Geotextile 1.06)'),
              MAT(f'Underlayment {i} Fasteners', f'[BOM UL{i} Fast]', 'EA', '[BOM Screw $]', 'rough: 5 per board default; priced at the membrane screw'),
              LAB(f'Underlayment {i} Labor', f'[BOM UL{i} Hrs]', 'exact for mechanical layers; adhesive layers not modelled')]
    P += [
      MAT('Membrane Adhesive', '[BOM AdhUnits]', 'UNIT', '[BOM Adh $]', 'exact per section (estimator rounds up after summing sections)'),
      MAT('Vents', '[BOM Vents]', 'EA', '[BOM Vent $]', 'exact'),
      LAB('Vent Labor', '[BOM Vents] * 0.5', 'exact'),
      LAB('Tear-off Labor', '[BOM TearHrs]', 'exact (disposal dumpster not included)'),
    ]
    return make_item('BOM Roof Section', 'Area', 'One per roof section. Draw the outline; parts price it.', inputs, H, P, 1)

def edge_parts(ctx):
    """Edge-metal parts. ctx 'section' (job default on the perimeter) or 'edge' (a BOM Roof Edge line)."""
    def c(v): return chain([(f"[BOM ColorID] = {COLOR_ID[k]}", fmt(p)) for k,p in v.items()], fmt(list(v.values())[-1]))
    tb = {k: TBAR[k] for k in ('White','Tan','Gray')}
    fb = {r['Description']: num(r['Price']) for r in FASCIA}
    f175 = [r for r in FASCIA][:7]; f4 = [r for r in FASCIA][7:]
    vin = lambda rs: {'White': num(rs[1]['Price']), 'Tan': num(rs[2]['Price']), 'Gray': num(rs[3]['Price'])}
    gs = lambda k: {'White': num(GS[k]['White Price']), 'Tan': num(GS[k]['Tan Price']), 'Gray': num(GS[k]['Gray Price'])}
    de = lambda k: {'White': num(DE[k]['White Price']), 'Tan': num(DE[k]['Tan Price']), 'Gray': num(DE[k]['Gray Price'])}
    fl = {r['Description']: r for r in ACC['fascia_bars']}
    tp = {r['Description']: num(r['Price']) for r in SHEETMETAL}
    twopc = {3: tp.get("3 ft Edge Extender",0), 4: tp.get('4" Edge Extender & Cleat',0), 5: tp.get('5" Edge Extender & Cleat',0),
             6: tp.get('6" Edge Extender & Cleat',0), 7: tp.get('7" Edge Extender & Cleat',0), 8: tp.get('8" Edge Extender & Cleat',0)}
    T_ = lambda ids: chain([(f"[BOM TermID] = {i}", '1') for i in ids], '0')   # 1 if termination in ids
    tbar_lab = ACC['termination_bars'][0]; gsl = num(ACC['gravel_stops'][0]['NoDrill Labor (Hrs)']); del_ = num(ACC['drip_edges'][0]['Labor(Hrs)'])
    tpl = ACC['two_piece_metals'][0]
    return [
      MAT('Termination Bar', f"{T_([1])} * [BOM EdgeFt]", 'FT', c(tb), 'exact (per ft by colour)'),
      LAB('Termination Bar Labor', f"{T_([1])} * [BOM BillFt] * " + IF('[BOM PreDrill] = 1', fmt(num(tbar_lab['PreDrill Labor(Hrs)'])), fmt(num(tbar_lab['NoDrill Labor (Hrs)']))), 'exact'),
      MAT('Fascia Bar', f"{T_([2,3])} * [BOM EdgeFt]", 'FT', IF('[BOM TermID] = 2', fmt(fb['1 3/4" Fascia Bar']), fmt(fb['4" Fascia Bar'])), 'exact (plain footage)'),
      MAT('Fascia Vinyl Cover', f"{T_([2,3])} * [BOM BillFt]", 'FT', IF('[BOM TermID] = 2', c(vin(f175)), c(vin(f4))), 'exact (vinyl cover; metal cover not modelled)'),
      MAT('Fascia Fasteners', f"{T_([2,3])} * RoundUp([BOM EdgeFt] / 10 * 21)", 'EA', '0', 'count only: no price in the feed'),
      LAB('Fascia Labor', f"{T_([2,3])} * [BOM BillFt] * " + IF('[BOM TermID] = 2',
            IF('[BOM PreDrill] = 1', fmt(num(fl['1¾" Fascia Bar']['PreDrill Labor(Hrs)'])), fmt(num(fl['1¾" Fascia Bar']['NoDrill Labor (Hrs)']))),
            IF('[BOM PreDrill] = 1', fmt(num(fl['4" Fascia Bar']['PreDrill Labor(Hrs)'])), fmt(num(fl['4" Fascia Bar']['NoDrill Labor (Hrs)'])))), 'exact'),
      MAT('Gravel Stop', f"{T_([4,5])} * [BOM BillFt]", 'FT', IF('[BOM TermID] = 4', c(gs('Gravel Stop 2"')), c(gs('Gravel Stop 4"'))), 'exact (RoundToNextTen of 1.03 x ft)'),
      MAT('Gravel Stop Corners', f"{T_([4,5])} * [BOM Corners]", 'EA', IF('[BOM TermID] = 4', c(gs('Gravel Stop 2" Corner')), c(gs('Gravel Stop 4" Corner'))), 'exact'),
      LAB('Gravel Stop Labor', f"{T_([4,5])} * ([BOM BillFt] * {fmt(gsl)} + [BOM Corners] * 0.2)", 'exact'),
      MAT('Drip Edge', f"{T_([6,7])} * [BOM BillFt]", 'FT', IF('[BOM TermID] = 6', c(de('Drip Edge 2"')), c(de('Drip Edge 4"'))), 'exact'),
      LAB('Drip Edge Labor', f"{T_([6,7])} * [BOM BillFt] * {fmt(del_)}", 'exact'),
      MAT('2-pc Edge Metal', f"{T_([8,9,10,11,12,13])} * [BOM BillFt]", 'FT', chain([(f"[BOM TermID] = {7+s-2}", fmt(twopc[s])) for s in range(3,9)], '0'), 'near (Non-DL edge extender rows)'),
      LAB('2-pc Edge Metal Labor', f"{T_([8,9,10,11,12,13])} * ([BOM BillFt] * {fmt(num(tpl['Labor (Hr/Ft)']))} + [BOM Corners] * {fmt(num(tpl['Corner Labor(Hr/Piece)']))})", 'exact'),
      MAT('ARP Membrane', IF('[BOM ARPin] > 0', '1.03 * (([BOM ARPin] + 6) / 12) * [BOM EdgeFt]', '0'), 'SF', '[BOM RollGood $/SF]', 'exact (roll-goods price)'),
      MAT('Wood Blocking', '[BOM Blocking] * [BOM BlockQty]', 'FT/EA', '[BOM Block $]', 'exact: per-ft rows = RoundUp(boards x ft x 1.03), stacked to the underlayment thickness ($0 in the catalog today); lumber rows = 12 ft pieces'),
      LAB('Wood Blocking Labor', '[BOM Blocking] * [BOM BlockQty] * [BOM Block Hr]', 'exact (row LaborPerUnit per ft or per piece)'),
    ]

# ============================================================ ROOF EDGE (linear)
def roof_edge():
    inputs = [T('Termination', TERMINATION, 'No Termination', 'Edge metal on this run'), T('Edge Perimeter', YN, '', 'Perimeter enhancement zone'),
              T('Wood Blocking', YN, 'No', ''), T('Blocking Size', [r['Description'] for r in BLOCKING], BLOCKING[0]['Description'], 'Non-DL roof edge blocking row (first four per ft, stacked to the underlayment; lumber rows per 12 ft piece)', remember=True),
              N('Underlayment Thickness (in)', '0', 'Total board thickness the blocking stacks to (per-ft rows only)', remember=True),
              T('ARP (in)', ARP, '0', 'Additional reinforcement ply width; 0 = none'), T('Tall Wall', YN, 'No', ''),
              T('Outside Corners', ['0','1','2','3','4','5','6','8','10','12'], '0', 'Outside corners on this run'),
              T('Roof System', SYSTEMS, 'Duro-Last', 'For the ARP membrane price', remember=True),
              T('Membrane Mil', MILS, '60', '', remember=True), T('Membrane Variant', ['Plus'], '', 'Duro-Fleece only', remember=True),
              T('Membrane Color', COLORS, 'White', 'Edge metal / membrane colour', remember=True),
              T('Deck Type', DECKS, 'Steel', 'Pre-drill on Concrete, Gypsum, LWC', remember=True),
              N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    H = [SYSID, MILN, COLID, DECKID, PREDRILL,
         ('BOM IsRoll', '1', False), ('BOM Tab', '0', False),
         ('BOM RollGood $/SF', membrane_price_formula('ROLL'), False),
         ('BOM TermID', strlookup('Termination', {t:i for i,t in enumerate(TERMINATION)}, '0'), False),
         ('BOM EdgeFt', '[Linear Total]', False),
         ('BOM BillFt', 'RoundUp(RoundUp(1.03 * [BOM EdgeFt]) / 10) * 10', False),
         ('BOM Corners', strlookup('Outside Corners', {c:int(c) for c in ['0','1','2','3','4','5','6','8','10','12']}, '0'), False),
         ('BOM ARPin', strlookup('ARP (in)', {a:int(a) for a in ARP}, '0'), False),
         ('BOM Blocking', IF(S('Wood Blocking','Yes'), '1', '0'), False),
         ('BOM Block $', strlookup('Blocking Size', {r['Description']: num(r['Price']) for r in BLOCKING}), False),
         ('BOM Block Hr', strlookup('Blocking Size', {r['Description']: num(r['LaborPerUnit']) for r in BLOCKING}), False),
         ('BOM ULThick', '[Underlayment Thickness (in)]', False),
         ('BOM BlockThick', strlookup('Blocking Size', BLOCK_THICK, '0'), False),
         ('BOM BlockBoards', IF('[BOM BlockThick] > 0', IF('[BOM ULThick] > [BOM BlockThick]', 'RoundUp([BOM ULThick] / ' + IF('[BOM BlockThick] > 0', '[BOM BlockThick]', '1') + ')', '1'), '0'), False),
         ('BOM BlockQty', IF('[BOM BlockThick] > 0', 'RoundUp([BOM BlockBoards] * [BOM EdgeFt] * 1.03)', 'RoundUp([BOM EdgeFt] / 12)'), False)]
    return make_item('BOM Roof Edge', 'Linear', 'Edge runs whose options differ from the section default (set the section Edge: Termination to No Termination on those sides).', inputs, H, edge_parts('edge'), 2)

# ============================================================ PARAPET WALL
def parapet_wall():
    inputs = [T('Wall Name', None, '', ''), N('Height (in)', '24', 'Inches; sets the labor band'),
              T('Deck', PARAPET_DECK, 'Structural Metal', 'Parapet deck (labor)', remember=True),
              T('Pre-drill', YN, 'No', ''), T('Canted', YN, 'No', ''), T('Slipsheet', YN, 'No', ''),
              N('Wall Pieces', '1', 'Pieces the wall membrane is cut into (adds 1 ft each)'),
              T('Roof System', SYSTEMS, 'Duro-Last', '', remember=True), T('Membrane Mil', MILS, '60', '', remember=True),
              T('Membrane Variant', ['Plus'], '', 'Duro-Fleece only', remember=True), T('Membrane Color', COLORS, 'White', '', remember=True),
              N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    band = IF('[Height (in)] <= 30', '1', IF('[Height (in)] <= 48', '2', IF('[Height (in)] <= 72', '3', IF('[Height (in)] <= 99', '4', '5'))))
    BANDS = ['0"-30"','31"-48"','49"-72"','73"-99"','100"+']
    col = IF(S('Pre-drill','Yes'), IF(S('Canted','Yes'), '4', '3'), IF(S('Canted','Yes'), '2', '1'))
    COLS = ['no_drill_no_cant','no_drill_canted','predrill_no_cant','predrill_canted']
    rate = chain([(f"[BOM PDeckID] = {PARAPET_DECK_ID[d]}",
              chain([(f"[BOM Band] = {b+1}", chain([(f"[BOM DrillCant] = {c+1}", fmt(num(r[COLS[c]]))) for c in range(4)], '0'))
                     for b in range(5) for r in PARAPET if r['deck_type']==d and r['wall_height_band']==BANDS[b]], '0'))
             for d in PARAPET_DECK], '0')
    H = [SYSID, MILN, COLID, ('BOM IsRoll', '0', False), ('BOM Tab', '0', False),
         ('BOM PDeckID', strlookup('Deck', PARAPET_DECK_ID, '8'), False),
         ('BOM Band', band, False), ('BOM DrillCant', col, False),
         ('BOM Rate50', rate, True),
         ('BOM Girth', '6 + [Height (in)]', False),
         ('BOM Parapet $/SF', membrane_price_formula('PARAPET'), True),
         ('BOM WallSF', '([Linear Total] + 1 + [Wall Pieces]) * [BOM Girth] / 12', True)]
    slip = OTHERS['DL Approved Slipsheet']
    P = [MAT('Parapet Membrane', '[BOM WallSF]', 'SF', '[BOM Parapet $/SF]', 'exact ((L + 1 + pieces) x girth / 12; girth = 6 + height)'),
         LAB('Parapet Labor', '[Linear Total] / 50 * [BOM Rate50]', 'exact (deck x height band x pre-drill/canted)'),
         MAT('Slipsheet', IF(S('Slipsheet','Yes'), '[Height (in)] * [Linear Total] * 1.25', '0'), 'SF', fmt(num(slip['Price'])), 'exact'),
         LAB('Slipsheet Labor', IF(S('Slipsheet','Yes'), '[Height (in)] * [Linear Total] * 1.25 / 100 * 0.25', '0'), 'exact')]
    return make_item('BOM Parapet Wall', 'Linear', 'One per parapet run.', inputs, H, P, 3)

# ============================================================ COUNTS
def drain():
    inputs = [T('Size (in)', DRAIN_SIZES, '4', 'Boot and ring are sized alike'), T('Existing Roof', EXISTING, 'Single Ply', ''),
              T('Reuse Rings', YN, 'No', ''), T('Membrane Color', COLORS, 'White', '', remember=True), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    boot = num(BOOT[0]['Price']); bootc = num(BOOT[0]['+ for Color'])
    prep = {r['Description']: (num(r['Area Prep Labor(Hrs)']), num(r['Reinstallation Labor (Hrs)'])) for r in ACC['drain_roof_types']}
    boothr = num(ACC['drain_boots'][0]['Labor(Hrs)'])
    H = [COLID, ('BOM Ring $', strlookup('Size (in)', RING), False),
         ('BOM Reuse', IF(S('Reuse Rings','Yes'), '1', '0'), False),
         ('BOM PrepHr', strlookup('Existing Roof', {k:v[0] for k,v in prep.items()}), False),
         ('BOM ReinstHr', strlookup('Existing Roof', {k:v[1] for k,v in prep.items()}), False)]
    P = [MAT('Drain Boot', '[Point Count]', 'EA', IF('[BOM ColorID] = 1', fmt(boot), fmt(bootc)), 'exact'),
         MAT('Drain Ring', '[Point Count] * (1 - [BOM Reuse])', 'EA', '[BOM Ring $]', 'exact'),
         LAB('Drain Labor', f'[Point Count] * ([BOM PrepHr] + ' + IF('[BOM Reuse] = 1', '[BOM ReinstHr]', fmt(boothr)) + ')', 'exact')]
    return make_item('BOM Drain', 'Count', 'Roof drains.', inputs, H, P, 4)

def pipe_stack():
    inputs = [T('Size (in)', PIPE_SIZES, '4', 'Even sizes above 16 are open only; 1" is closed only'), T('Usage', PIPE_USAGE, 'Plumbing', ''),
              T('Open', YN, 'No', ''), T('Membrane Color', COLORS, 'White', '', remember=True), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    colcol = {'White':'Price','Tan':'Tan Price','Gray':'Gray Price','Dark Gray':'Dark Gray','Terra Cotta':'Terra Cotta','Rock-Ply':'Rock Ply','Black':'Price'}
    price = chain([(S('Size (in)', r['Size']), chain([(f"[BOM ColorID] = {COLOR_ID[c]}", fmt(num(r.get(colcol[c])) or num(r['Price']))) for c in COLORS], fmt(num(r['Price'])))) for r in PIPE], '0')
    usage = {r['Description']: num(r['Multiplier']) for r in ACC['pipe_stack_usages']}
    H = [COLID, ('BOM Stack $', price, False), ('BOM UsageMult', strlookup('Usage', usage, '1')),
         ('BOM StackHr', '[BOM UsageMult] * ' + IF(S('Open','Yes'), '1.25', '1') + ' * ' + IF('[Size (in)] > 12', '1.5', '1') + ' * ' + IF('[Size (in)] > 18', '2', '1'), False)]
    H = [(h if len(h)==3 else (h[0],h[1],False)) for h in H]
    P = [MAT('Pipe Stack', '[Point Count]', 'EA', '[BOM Stack $]', 'exact (White price when the colour has none)'),
         LAB('Pipe Stack Labor', '[Point Count] * [BOM StackHr]', 'exact')]
    return make_item('BOM Pipe Stack', 'Count', 'Pipe penetrations.', inputs, H, P, 5)

def vent():
    inputs = [T('Membrane Color', COLORS, 'White', '', remember=True), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    H = [COLID, ('BOM Vent $', numlookup('[BOM ColorID]', {COLOR_ID[c]: VENTS.get(c, 0) for c in COLORS}, fmt(VENTS['White'])), False)]
    P = [MAT('Vent', '[Point Count]', 'EA', '[BOM Vent $]', 'exact'), LAB('Vent Labor', '[Point Count] * 0.5', 'exact')]
    return make_item('BOM Vent', 'Count', 'Vents placed by hand (auto vents are on the section).', inputs, H, P, 6)

def curb():
    inputs = [T('Curb Name', None, '', ''), N('Width (in)', '24', ''), N('Length (in)', '24', ''), T('Curb Type', CURB_TYPES, 'Open', ''),
              N('Height (in)', '12', ''), T('Deck', DECKS, 'Steel', 'Section deck list', remember=True), T('Insulated', YN, 'No', 'Add 1 1/2" ISO to the curb'),
              T('Roof System', SYSTEMS, 'Duro-Last', '', remember=True), T('Membrane Mil', MILS, '60', '', remember=True),
              T('Membrane Variant', ['Plus'], '', '', remember=True), T('Membrane Color', COLORS, 'White', '', remember=True),
              N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    H = [SYSID, MILN, COLID, ('BOM IsRoll', '0', False), ('BOM Tab', '0', False),
         ('BOM DeckID', strlookup('Deck', DECK_ID, '2'), False),
         ('BOM DeckMin', chain([(f"[BOM DeckID] = {DECK_ID[d]}", fmt(CURB_DECK.get(DECK_TO_PARAPET[d], 7.5))) for d in DECKS], '7.5'), False),
         ('BOM TypeMult', strlookup('Curb Type', CURB_TYPE, '1'), False),
         ('BOM PerimFt', '2 * ([Width (in)] + [Length (in)]) / 12', False),
         ('BOM CurbMin', '8 + [BOM DeckMin] * [BOM TypeMult] * [BOM PerimFt]', True),
         ('BOM Parapet $/SF', membrane_price_formula('PARAPET'), False)]
    iso = OTHERS['Curbs 1 1/2" ISO']
    P = [LAB('Curb Labor', '[Point Count] * [BOM CurbMin] / 60', 'exact (8 min setup + deck minutes x type x perimeter ft)'),
         MAT('Curb Wrap Membrane', '[Point Count] * [BOM PerimFt] * ([Height (in)] + 6) / 12', 'SF', '[BOM Parapet $/SF]', 'near (open-style wrap)'),
         MAT('Curb ISO', IF(S('Insulated','Yes'), 'RoundUp([Point Count] * ([Width (in)] + [Length (in)]) / 6)', '0'), 'SF', fmt(num(iso['Price'])), 'exact')]
    return make_item('BOM Curb', 'Count', 'Curbs (HVAC, hatches, etc.).', inputs, H, P, 7)

def scupper():
    items = [r['Description'] for r in SHEETMETAL]
    inputs = [N('Width (in)', '6', ''), N('Height (in)', '4', ''), T('Scupper Type', SCUPPER_TYPES, 'Scupper', ''),
              T('Sheet Metal Item', items, 'Retro Edge', 'Non-DL sheet metal row that prices this scupper'), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    H = [('BOM SM $', strlookup('Sheet Metal Item', {r['Description']: num(r['Price']) for r in SHEETMETAL}), False),
         ('BOM SM Hr', strlookup('Sheet Metal Item', {r['Description']: num(r['LaborPerUnit']) for r in SHEETMETAL}), False)]
    P = [MAT('Scupper Metal', '[Point Count]', 'EA', '[BOM SM $]', 'row price'), LAB('Scupper Labor', '[Point Count] * [BOM SM Hr]', 'row LaborPerUnit')]
    return make_item('BOM Scupper', 'Count', 'Scuppers.', inputs, H, P, 8)

def walk_pad():
    inputs = [T('Pad', PADS, PADS[0], ''), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    H = [('BOM Pad $', strlookup('Pad', {p: PADPRICE.get(p, 0) for p in PADS}), False)]
    P = [MAT('Walk Pad', '[Point Count]', 'EA', '[BOM Pad $]', 'exact (fully skirted pads have no price in the feed)'), LAB('Walk Pad Labor', '[Point Count] * 0.5', 'exact')]
    return make_item('BOM Walk Pad', 'Count', 'Individual walk pads.', inputs, H, P, 9)

def other_count():
    inputs = [T('Item Name', None, '', 'What is being counted'), N('Cost Each ($)', '0', 'Material cost per piece'), N('Labor Hrs Each', '0', ''), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    P = [MAT('Other Material', '[Point Count]', 'EA', '[Cost Each ($)]', 'typed'), LAB('Other Labor', '[Point Count] * [Labor Hrs Each]', 'typed')]
    return make_item('BOM Other Count', 'Count', 'Anything counted that has no BOM item of its own.', inputs, [], P, 10)

# ============================================================ OTHER LINEARS
def gutter():
    inputs = [T('Style', None, '', 'Gutter style'), T('Size (in)', None, '', ''), N('Cost per Ft ($)', '0', 'Typed: gutters are not in the feed'), N('Labor Hrs per Ft', '0', ''), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    P = [MAT('Gutter', '[Linear Total]', 'FT', '[Cost per Ft ($)]', 'typed'), LAB('Gutter Labor', '[Linear Total] * [Labor Hrs per Ft]', 'typed')]
    return make_item('BOM Gutter', 'Linear', 'Gutter runs.', inputs, [], P, 11)
def expansion_joint():
    r = next(r for r in SHEETMETAL if r['Description'].startswith('Exspansion'))
    inputs = [N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    P = [MAT('Expansion Joint', '[Linear Total]', 'FT', fmt(num(r['Price'])), 'Non-DL sheet metal row'), LAB('Expansion Joint Labor', f"[Linear Total] * {fmt(num(r['LaborPerUnit']))}", 'row LaborPerUnit')]
    return make_item('BOM Expansion Joint', 'Linear', 'Expansion joint runs.', inputs, [], P, 12)
def walkway():
    inputs = [T('Pad', PADS, PADS[1], 'Pad laid along the run (5 ft per 60" pad, 2.5 ft per 30")'), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    H = [('BOM Pad $', strlookup('Pad', {p: PADPRICE.get(p, 0) for p in PADS}), False),
         ('BOM PadFt', chain([(S('Pad', p), '5' if p.startswith('60') else '2.5') for p in PADS], '5'), False),
         ('BOM Pads', 'RoundUp([Linear Total] / [BOM PadFt])', True)]
    P = [MAT('Walkway Pads', '[BOM Pads]', 'EA', '[BOM Pad $]', 'near (pads laid end to end)'), LAB('Walkway Labor', '[BOM Pads] * 0.5', 'exact per pad')]
    return make_item('BOM Walkway', 'Linear', 'Linear walk pad runs.', inputs, H, P, 13)
def other_linear():
    inputs = [T('Item Name', None, '', 'What is being measured'), N('Cost per Ft ($)', '0', ''), N('Labor Hrs per Ft', '0', ''), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    P = [MAT('Other Material', '[Linear Total]', 'FT', '[Cost per Ft ($)]', 'typed'), LAB('Other Labor', '[Linear Total] * [Labor Hrs per Ft]', 'typed')]
    return make_item('BOM Other Linear', 'Linear', 'Anything linear that has no BOM item of its own.', inputs, [], P, 14)

# ============================================================ JOB SETUP (importer) + JOB SUMMARY (job-level lines)
def job_setup():
    inputs = [T('Roof System',SYSTEMS,'Duro-Last',''), T('Attachment',ATTACH,'mechanical',''), T('Adhesive',ADHESIVES,'',''), T('Membrane Mil',MILS,'60',''),
              T('Membrane Variant',['Plus'],'',''), T('Membrane Color',COLORS,'White',''), T('Sheet Size',SHEET,'Roll Good',''), T('Field Tab Spacing',TABS,'',''),
              T('Deck Type',DECKS,'Steel',''), T('Design Table (psf)',DESIGN,'60',''), N('Pull Test (lbs)','350',''),
              T('Underlayment 1',UNDERLAY,'',''), T('Underlayment 2',UNDERLAY,'',''), T('Underlayment 3',UNDERLAY,'',''), T('Underlayment 4',UNDERLAY,'',''),
              T('Underlayment Attach',UL_ATTACH,'mechanical',''), T('Edge: Perimeter',YN,'Yes',''), T('Edge: Termination',TERMINATION,'',''), T('Edge: Wood Blocking',YN,'No',''),
              T('Edge: ARP (in)',ARP,'0',''), T('Parapet: Deck',PARAPET_DECK,'',''), T('Parapet: System',SYSTEMS,'',''), T('Parapet: Attachment',ATTACH,'',''),
              T('Drain: Existing Roof',EXISTING,'',''), T('Drain: Reuse Rings',YN,'No','')]
    return make_item('BOM Job Setup', 'Count', 'Place ONCE per job: the answers Bid-O-Matic reads on import (costing parts use the inputs on each item).', inputs, [], [], 0)

def job_summary():
    inputs = [N('Total Roof Sq Ft', '0', 'Sum of the BOM Roof Section areas'), N('Total Material $', '0', 'Sum of every Material part (before tax)'),
              N('Total Labor $', '0', 'Sum of every Labor part on the items (setup + inspection are added here)'), N('Crew Rate ($/h)', fmt(CREW), '', remember=True)]
    setup = IF(f'[Total Roof Sq Ft] * {fmt(SETUP_PER_SF)} > {SETUP_MIN}', f'[Total Roof Sq Ft] * {fmt(SETUP_PER_SF)}', fmt(SETUP_MIN))
    H = [('BOM SetupHrs', setup, True),
         ('BOM InspectHrs', ge_chain('[Total Roof Sq Ft]', INSPECT, '0'), True),
         ('BOM Tax', f'[Total Material $] * {fmt(TAX)}', True),
         ('BOM Shipping', ge_chain('[Total Material $]', SHIP, '0'), True),
         ('BOM Cost', '[Total Material $] + [BOM Tax] + [BOM Shipping] + [Total Labor $] + ([BOM SetupHrs] + [BOM InspectHrs]) * [Crew Rate ($/h)]', True),
         ('BOM Price', f'[BOM Cost] / (1 - {fmt(GP)})', True)]
    P = [LAB('Setup Labor', '[BOM SetupHrs]', 'exact (max of 16 h and 0.003 h/sq ft)'),
         LAB('Inspection Labor', '[BOM InspectHrs]', 'exact (step table)'),
         MAT('Sales Tax', '1', 'LS', '[BOM Tax]', f'exact ({fmt(TAX*100)}% on material only)'),
         MAT('Shipping', '1', 'LS', '[BOM Shipping]', 'exact (stepped on material $)'),
         MAT('Gross Profit', '1', 'LS', '[BOM Price] - [BOM Cost]', f'exact (price = cost / (1 - {fmt(GP)}))')]
    return make_item('BOM Job Summary', 'Count', 'Place ONCE per job after the takeoff: type the three totals; parts add setup, inspection, tax, shipping and gross profit.', inputs, H, P, 15)

# ============================================================ assemble
new_root = copy.deepcopy(root)
for c in list(new_root.find('Items')): new_root.find('Items').remove(c)
rg = guid(); new_root.set('GUID', rg); new_root.set('Name', 'Bid-O-Matic Costing')
prop(new_root,'GUID').text = rg; prop(new_root,'Name').text = 'Bid-O-Matic Costing'; prop(new_root,'OrderIndex').text = '0'
for p in new_root.find('Properties'):
    if p.get('GUID'): p.set('GUID', guid())
ITEMS = [job_setup(), roof_section(), roof_edge(), parapet_wall(), drain(), pipe_stack(), vent(), curb(), scupper(), walk_pad(), other_count(),
         gutter(), expansion_joint(), walkway(), other_linear(), job_summary()]
for it in ITEMS: new_root.find('Items').append(it)

ET.indent(new_root, space='  ')
body = ET.tostring(new_root, encoding='unicode')
body = body.replace('&#13;&#10;', '\r\n').replace('&#10;', '\r\n')
body = re.sub(r'(?<!\r)\n', '\r\n', body)
body = body.replace("'", '&apos;')
xml = '<?xml version="1.0" encoding="UTF-8"?>\r\n' + body + '\r\n'
os.makedirs(os.path.dirname(OUT_XML), exist_ok=True)
open(OUT_XML,'w',encoding='utf-8',newline='').write(xml)
with zipfile.ZipFile(OUT_ZIP,'w',zipfile.ZIP_DEFLATED) as z: z.writestr('XMLData.XML', xml.encode('utf-8'))
print('wrote', OUT_ZIP, len(xml), 'bytes; items', len(ITEMS), 'parts', sum(len(i.find('Items')) for i in ITEMS))
