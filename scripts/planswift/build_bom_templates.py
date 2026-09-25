#!/usr/bin/env python3
"""Build Bid-O-Matic.SwiftTemplates for PlanSwift 11 from the sample export.

Clones Basic Area / Basic Linear / Basic Count from the user's own v11 export so
every system property, icon and formula is exactly what PlanSwift 11 wrote, then
renames, re-GUIDs, zeroes Cost Each and adds the Bid-O-Matic input properties
(dropdowns) defined in planswift-mapping.md.
"""
import copy, re, uuid, zipfile, io, os
import xml.etree.ElementTree as ET
HERE = os.path.dirname(os.path.abspath(__file__))

SRC = os.environ.get('PS_SAMPLE_XML', os.path.join(HERE, 'sample', 'XMLData.XML'))
OUT_DIR = os.environ.get('PS_OUT', os.path.join(HERE, 'out'))
OUT_XML = os.path.join(OUT_DIR, 'quantities', 'XMLData.XML')
OUT_ZIP = os.path.join(OUT_DIR, 'Bid-O-Matic.SwiftTemplates')

CRLF = '\r\n'
def guid(): return '{' + str(uuid.uuid4()).upper() + '}'

# ---------------------------------------------------------------- value lists
SYSTEMS = ['Duro-Last','Duro-Tuff','Duro-Bond','Duro-Fleece','Duro-Roof','Duro-Tech TPO','Non-DL TPO','EPDM Rubber']
ATTACH = ['mechanical','adhered']
ADHESIVES = ['Water Based Adhesive','Solvent Based Adhesive','Duro-Fleece Adhesive(2-boxes)','Duro-Fleece Adhesive(cartridge)',
  'Duro-Grip Adhesive(CR-20)','OlyBond500 Bag-in-Box','OlyBond500 SpotShot','Millenium One Step','Millenium PG1 Boxes',
  'Millenium PG1 Drums','TECH-Bond TPO Bonding Adhesive','TECH-Bond TPO LVOC Bonding Adhesive','TECH-Bond TPO Spray Adhesive',
  'Non-DL TPO Bonding Adhesive','Non-DL TPO Spray Adhesive','EPDM Bonding Adhesive','EPDM Spray Adhesive']
MILS = ['40','45','50','60','75','80','90']
COLORS = ['White','Tan','Gray','Dark Gray','Terra Cotta','Rock-Ply','Black']
SHEET = ['Roll Good','500 sf','1000 sf','1500 sf','2000 sf','2500 sf','3000 sf']
TABS = ['28','30','57','60','87','120','240']
DECKS = ['Wood','Steel','Retrofit','Concrete','Gypsum','LWC/Steel','LWC/Concrete','LWC/Other','Tectum','Purlin']
DESIGN = ['60','90','120','150','180','210']
UNDERLAY = ['1/4" Dens Deck','1/2" HD ISO 4\'x 4\'','1/2" ISO','1/2" Rigid 4\'x 4\'','1" ISO','1" ISO 4\'x 4\'','1" Rigid','1" Rigid 4\'x 4\'',
  '1/2" DensDeck Prime','1/2" Securock GFRB','1/4" DensDeck Prime','1/4" Securock GFRB','1 1/2" ISO','1 1/2" ISO 4\'x 4\'','1 1/2" Rigid',
  '1 1/2" Rigid 4\'x 4\'','2" ISO','2" ISO 4\'x 4\'','2" Rigid','2" Rigid 4\'x 4\'','2.7" ISO','2.7" ISO 4\'x 4\'','2.7" Rigid','2.7" Rigid 4\'x 4\'',
  '2 1/2" ISO','2 1/2" ISO 4\'x 4\'','2 1/2" Rigid','2 1/2" Rigid 4\'x 4\'','3" ISO','3" ISO 4\'x 4\'','3" Rigid','3" Rigid 4\'x 4\'',
  '3/8" Dens Deck','3/8" Securock GFRB','3 1/2" ISO','3 1/2" ISO 4\'x 4\'','3 1/2" Rigid','3 1/2" Rigid 4\'x 4\'','4" ISO','4" ISO 4\'x 4\'',
  '4" Rigid','4" Rigid 4\'x 4\'','5/8" DensDeck Prime','5/8" F/C Sheet Rock','5/8" Securock GFRB','Duro-Blue Slipsheet','Duro-Fold',
  'Duro-Weave','FR 10','FR 50','Geotextile','Ultra-Fold']
UL_ATTACH = ['mechanical','adhesive','none','durobond']
YN = ['Yes','No']
TERMINATION = ['No Termination','T-Bar','1-3/4" Fascia','4" Fascia','2" Gravel Stop','4" Gravel Stop','2" Drip Edge','4" Drip Edge',
  '3" 2-pc Metal','4" 2-pc Metal','5" 2-pc Metal','6" 2-pc Metal','7" 2-pc Metal','8" 2-pc Metal']
ARP = ['0','12','18','24','30']
PARAPET_DECK = ['Concrete','Gypsum','LWC over Concrete','LWC over Other','LWC over Steel','Metal Retrofit','Purlin Fastened',
  'Structural Metal','Tectum','Wood']
EXISTING = ['None','Single Ply','BUR','GS BUR']
DRAIN_SIZES = ['2','2 1/2','3','3 1/2','4','4 1/2','5','5 1/2','6','6 1/2','7','7 1/2','8']
PIPE_SIZES = ['1','1.5'] + [str(n) for n in range(2,17)] + [str(n) for n in range(18,45,2)]
PIPE_USAGE = ['Plumbing','Hot Stack','Pitch Pan']
CURB_TYPES = ['Open','Closed','Closed w/ Top','Scupper','Metal Scupper']
SCUPPER_TYPES = ['Scupper','Metal Scupper']
PADS = ['30" x 60" White - Walk Pad','60" x 60" White - Walk Pad','30" x 60" Gray - Walk Pad','60" x 60" Gray - Walk Pad',
  '30" x 60" Safety - Walk Pad','60" x 60" Safety - Walk Pad','30" x 60" Tan - Walk Pad','60" x 60" Tan - Walk Pad',
  '30"X 60" Safety Fully Skirted Walk Pad','30"X 60" White Fully Skirted Walk Pad']

BLANK_HINT = ' (leave blank = use Job Setup)'
BUILTIN = {'Area','Perimeter','Linear Total','Point Count','Segment Count','Count','Color','Type','Name','Shape',
           'Scaled','Count Size','Length','Width','Height','Depth','Pitch','Thickness','Diameter','Weight','Line Width','Line Side'}

# (name, class, list or None, default, hint)
def T(name, lst=None, default='', hint=''): return (name,'Text',lst,default,hint)
def N(name, lst=None, default='', hint=''): return (name,'Number',lst,default,hint)

ITEMS = [
 # name, base type, description, inputs, hint for whole item
 ('BOM Job Setup','Count','Place ONCE per job. Material answers Bid-O-Matic applies to every section.',[
    T('Roof System',SYSTEMS,'Duro-Last','Eight systems Bid-O-Matic prices'),
    T('Attachment',ATTACH,'mechanical','Duro-Bond & Duro-Roof: mechanical only. Duro-Fleece: adhered only'),
    T('Adhesive',ADHESIVES,'','Only read when Attachment = adhered'),
    T('Membrane Mil',MILS,'60','DL/Bond/Fleece 40,50,60 - Tuff 50,60 - TPO 45,60,80 - EPDM 45,60,75,90'),
    T('Membrane Variant',['Plus'],'','Duro-Fleece only; blank = standard'),
    T('Membrane Color',COLORS,'White','Membrane colour (price column)'),
    T('Sheet Size',SHEET,'Roll Good','Duro-Roof has no Roll Good; Duro-Bond tops out at 2500 sf'),
    T('Field Tab Spacing',TABS,'','Inches. DL 28,60,120 - Roof 57,87,120 - Tuff/TPO 30,60,120 - EPDM 120,240'),
    T('Deck Type',DECKS,'Steel','Roof section deck (labor multiplier)'),
    T('Design Table (psf)',DESIGN,'60','Wind design table'),
    N('Pull Test (lbs)',None,'350','Drives the fastener spacing lookup'),
    T('Underlayment 1',UNDERLAY,'','Bottom layer first; blank = no layer'),
    T('Underlayment 2',UNDERLAY,'','Blank = no layer'),
    T('Underlayment 3',UNDERLAY,'','Blank = no layer'),
    T('Underlayment 4',UNDERLAY,'','Blank = no layer'),
    T('Underlayment Attach',UL_ATTACH,'mechanical','How the boards are attached'),
    T('Edge: Perimeter',YN,'Yes','Default for every roof edge (perimeter enhancement zone)'),
    T('Edge: Termination',TERMINATION,'','Default edge metal'),
    T('Edge: Wood Blocking',YN,'No','Blocking the full length of each edge'),
    T('Edge: ARP (in)',ARP,'0','Additional reinforcement ply width; 0 = none'),
    T('Parapet: Deck',PARAPET_DECK,'','Parapet labor deck'),
    T('Parapet: System',SYSTEMS,'','Blank = same as the roof'),
    T('Parapet: Attachment',ATTACH,'','Blank = same as the roof'),
    T('Drain: Existing Roof',EXISTING,'','Default for every drain'),
    T('Drain: Reuse Rings',YN,'No',''),
  ]),
 ('BOM Roof Section','Area','One per roof section. Draw the outline; Bid-O-Matic computes all quantities.',[
    T('Section Name',None,'','e.g. Main Roof, Upper Roof, Penthouse'),
    T('Cut-out of',None,'','Only for wells / penthouses: parent section name to subtract from'),
    T('Deck Type',DECKS,'','Override'+BLANK_HINT),
    T('Membrane Mil',MILS,'','Override'+BLANK_HINT),
    T('Membrane Color',COLORS,'','Override'+BLANK_HINT),
    T('Sheet Size',SHEET,'','Override'+BLANK_HINT),
    T('Field Tab Spacing',TABS,'','Override'+BLANK_HINT),
  ]),
 ('BOM Roof Edge','Linear','Optional. Only for edge runs whose options differ from the Job Setup defaults.',[
    T('Termination',TERMINATION,'','Edge metal on this run'),
    T('Edge Perimeter',YN,'','Perimeter enhancement zone'),
    T('Wood Blocking',YN,'',''),
    T('ARP (in)',ARP,'','Additional reinforcement ply width; 0 = none'),
    T('Tall Wall',YN,'',''),
  ]),
 ('BOM Parapet Wall','Linear','One per parapet run.',[
    T('Wall Name',None,'',''),
    N('Height (in)',None,'','Inches; estimator derives the labor band'),
    T('Deck',PARAPET_DECK,'','Parapet deck'+BLANK_HINT),
    T('Pre-drill',YN,'No',''),
    T('Canted',YN,'No',''),
    T('Slipsheet',YN,'No',''),
  ]),
 ('BOM Drain','Count','Roof drains.',[
    T('Size (in)',DRAIN_SIZES,'4','Boot and ring are sized alike'),
    T('Existing Roof',EXISTING,'','Blank = Job Setup'),
    T('Reuse Rings',YN,'','Blank = Job Setup'),
  ]),
 ('BOM Pipe Stack','Count','Pipe penetrations.',[
    T('Size (in)',PIPE_SIZES,'','Even sizes above 16 are open only; 1" is closed only'),
    T('Usage',PIPE_USAGE,'Plumbing',''),
    T('Open',YN,'No',''),
  ]),
 ('BOM Vent','Count','Vents.',[
    T('Membrane Color',COLORS,'White','Membrane colour list'),
  ]),
 ('BOM Curb','Count','Curbs (HVAC, hatches, etc.).',[
    T('Curb Name',None,'',''),
    N('Width (in)',None,'',''),
    N('Length (in)',None,'',''),
    T('Curb Type',CURB_TYPES,'Open',''),
    N('Height (in)',None,'',''),
    T('Deck',DECKS,'','Section deck list'+BLANK_HINT),
  ]),
 ('BOM Scupper','Count','Scuppers.',[
    N('Width (in)',None,'',''),
    N('Height (in)',None,'',''),
    T('Scupper Type',SCUPPER_TYPES,'Scupper',''),
  ]),
 ('BOM Walk Pad','Count','Individual walk pads.',[
    T('Pad',PADS,'30" x 60" White - Walk Pad',''),
  ]),
 ('BOM Other Count','Count','Anything counted that has no BOM item of its own.',[
    T('Item Name',None,'','Free text - what is being counted'),
  ]),
 ('BOM Gutter','Linear','Gutter runs (placed by hand in the bid).',[
    T('Style',None,'','Gutter style'),
    T('Size (in)',None,'','Gutter size in inches'),
  ]),
 ('BOM Expansion Joint','Linear','Expansion joint runs.',[]),
 ('BOM Walkway','Linear','Linear walk pad runs.',[]),
 ('BOM Other Linear','Linear','Anything linear that has no BOM item of its own.',[
    T('Item Name',None,'','Free text - what is being measured'),
  ]),
]

# ---------------------------------------------------------------- load source
tree = ET.parse(SRC); root = tree.getroot()
def find_item(name):
    for it in root.iter('Item'):
        if it.get('Name') == name: return it
    raise KeyError(name)
BASES = {'Area': find_item('Basic Area'), 'Linear': find_item('Basic Linear'), 'Count': find_item('Basic Count')}

def prop(item, name):
    for p in item.find('Properties'):
        if p.get('Name') == name: return p
    return None

def make_item(name, base_type, desc, inputs, order):
    it = copy.deepcopy(BASES[base_type])
    props = it.find('Properties')
    g = guid()
    it.set('GUID', g); it.set('Name', name)
    prop(it,'GUID').text = g
    prop(it,'Name').text = name
    prop(it,'OrderIndex').text = str(order)
    d = prop(it,'Description'); d.text = ''; d.set('ToolHint', desc)
    prop(it,'Cost Each').text = '0'          # rule 1: no prices in PlanSwift
    prop(it,'Waste %').text = '0'
    prop(it,'Division').text = '07.3  Roofing (Div 07.30.00)'
    # fresh GUIDs for every property so nothing collides with the user's library
    for p in props:
        if p.get('GUID'): p.set('GUID', guid())
    # custom inputs go right after Description, in their own group
    idx = list(props).index(d) + 1
    base_order = float(d.get('OrderIndex'))
    layout_names = []
    for i,(pname,pclass,lst,default,hint) in enumerate(inputs):
        # never shadow a PlanSwift system property or built-in takeoff result
        existing = {q.get('Name') for q in props} | BUILTIN
        assert pname not in existing, f'{name}: input {pname!r} collides with a PlanSwift property'
        p = ET.Element('Property', {'Class':pclass,'GUID':guid(),'Name':pname,'input':'True',
                                    'group':'Bid-O-Matic','OrderIndex':f'{base_order + 0.01*(i+1):.2f}',
                                    'DecimalPlaces':'2'})
        if lst:
            p.set('SimpleList', CRLF.join(lst))
            p.set('List','cmbList'); p.set('PluginToExecute','cmbList')
        if hint: p.set('ToolHint', hint)
        p.text = default
        props.insert(idx, p); idx += 1
        layout_names.append(pname)
    # Form Layout: Name, Description, then our inputs, then whatever the base had (Color/Shape/...)
    fl = prop(it,'Form Layout')
    old = ET.fromstring(fl.text.encode('utf-8'))
    keep = [e for e in old if e.get('Name') not in ('Name','Description')]
    new = ET.Element('Items'); o = 0
    for nm in ['Name','Description'] + layout_names:
        ET.SubElement(new,'Item',{'Name':nm,'Order':str(o),'ShowUnits':'False','SameLine':'False','Tab':''}); o+=1
    for e in keep:
        e.set('Order',str(o)); new.append(e); o+=1
    fl.text = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(new, encoding='unicode')
    # no child items
    kids = it.find('Items')
    if kids is None: kids = ET.SubElement(it,'Items')
    for c in list(kids): kids.remove(c)
    return it

# ---------------------------------------------------------------- root folder
new_root = copy.deepcopy(root)
for c in list(new_root.find('Items')): new_root.find('Items').remove(c)
rg = guid()
new_root.set('GUID', rg); new_root.set('Name','Bid-O-Matic')
prop(new_root,'GUID').text = rg
prop(new_root,'Name').text = 'Bid-O-Matic'
prop(new_root,'OrderIndex').text = '0'
for p in new_root.find('Properties'):
    if p.get('GUID'): p.set('GUID', guid())

for i,(name,bt,desc,inputs) in enumerate(ITEMS):
    new_root.find('Items').append(make_item(name,bt,desc,inputs,i))

# ---------------------------------------------------------------- serialise
ET.indent(new_root, space='  ')
body = ET.tostring(new_root, encoding='unicode')
# ET escapes CR/LF inside attributes as entities; PlanSwift writes them raw. Match PlanSwift.
body = body.replace('&#13;&#10;', '\r\n').replace('&#10;', '\r\n')
# document line endings -> CRLF (but don't double up the CRLFs we just placed)
body = re.sub(r'(?<!\r)\n', '\r\n', body)
body = body.replace("'", '&apos;')   # PlanSwift writes apostrophes as entities
xml = '<?xml version="1.0" encoding="UTF-8"?>\r\n' + body + '\r\n'

os.makedirs(os.path.dirname(OUT_XML), exist_ok=True)
open(OUT_XML,'w',encoding='utf-8',newline='').write(xml)
with zipfile.ZipFile(OUT_ZIP,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('XMLData.XML', xml.encode('utf-8'))
print('wrote', OUT_ZIP, len(xml), 'bytes xml')
