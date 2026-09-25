"""Tiny evaluator for the PlanSwift formula subset used in the generated templates.
Lets us run a takeoff through the XML without PlanSwift: [Prop], [!if(c,a,b)],
'[Text]' = 'x', RoundUp/RoundDown/Round/Sqrt, parent inheritance for parts."""
import math, re, zipfile, xml.etree.ElementTree as ET

def load(path):
    raw = zipfile.ZipFile(path).read('XMLData.XML')
    return ET.fromstring(raw)

class Item:
    def __init__(self, el, parent=None):
        self.el, self.parent = el, parent
        self.name = el.get('Name')
        self.props = {p.get('Name'): (p.text or '') for p in el.find('Properties')}
        self.kids = [Item(c, self) for c in (el.find('Items') if el.find('Items') is not None else [])]
        self.memo = {}
    def find(self, name):
        for k in self.kids:
            if k.name == name: return k
        raise KeyError(name)

def to_py(f):
    # [!if( ... )]  ->  IF( ... )   (drop the ']' matching each '[!if(')
    out = []; i = 0; stack = []
    while i < len(f):
        if f.startswith('[!if(', i):
            out.append('IF('); stack.append(len(out)); i += 5
            depth = 1; j = i; buf = ''
            # copy until matching ')' at depth 0 then skip the ']'
            while j < len(f):
                ch = f[j]
                if ch == '(': depth += 1
                elif ch == ')':
                    depth -= 1
                    if depth == 0:
                        out.append(to_py(buf)); out.append(')'); j += 1
                        assert f[j] == ']', f[j-5:j+5]; j += 1; break
                buf += ch; j += 1
            i = j; continue
        out.append(f[i]); i += 1
    s = ''.join(out)
    s = re.sub(r'(?<![<>!=])=(?!=)', '==', s)
    s = s.replace('RoundUp(', 'ceil(').replace('RoundDown(', 'floor(').replace('Round(', 'rnd(').replace('Sqrt(', 'sqrt(')
    return s

def rnd(x): return math.floor(x + 0.5)
def IF(c, a, b): return a if c else b

def ev(item, prop, overrides=None, trace=None):
    """Evaluate property `prop` of `item` (inherit from parent if missing)."""
    overrides = overrides or {}
    if prop in overrides: return overrides[prop]
    it = item
    while it is not None and prop not in it.props: it = it.parent
    if it is None: raise KeyError(f'{item.name}: no property {prop!r}')
    key = (id(it), prop)
    if key in item.memo: return item.memo[key]
    raw = it.props[prop]
    # text properties with a value that is not a formula
    if '[' not in raw:
        try: v = float(raw) if raw.strip() != '' else ''
        except ValueError: v = raw
        item.memo[key] = v; return v
    f = raw
    # quoted refs -> literal text
    def qsub(m):
        name = m.group(1)
        if name in overrides: return "'" + str(overrides[name]) + "'"
        it2 = item
        while it2 is not None and name not in it2.props: it2 = it2.parent
        rawv = it2.props[name] if it2 is not None else ''
        if '[' not in rawv: return "'" + rawv + "'"
        v = ev(item, name, overrides, trace); return "'" + str(v if v != '' else '') + "'"
    f = re.sub(r"'\[([^\]]+)\]'", qsub, f)
    # unquoted refs -> numeric value
    def nsub(m):
        v = ev(item, m.group(1), overrides, trace)
        if v == '' : v = 0
        if isinstance(v, str):
            try: v = float(v)
            except ValueError: raise ValueError(f'non-numeric {m.group(1)!r}={v!r} used numerically in {prop!r}')
        return '(' + repr(float(v)) + ')'
    f = re.sub(r"\[(?!!if\()([^\]\[]+)\]", nsub, f)
    py = to_py(f)
    try:
        v = eval(py, {'IF': IF, 'ceil': math.ceil, 'floor': math.floor, 'rnd': rnd, 'sqrt': math.sqrt, 'True': True, 'False': False})
    except Exception as e:
        raise RuntimeError(f'{item.name}.{prop}: {e}\n  raw={raw[:300]}\n  py={py[:300]}')
    item.memo[key] = v
    if trace is not None: trace.append((prop, v))
    return v

def run_item(root_item, overrides):
    """Evaluate every part: returns [(part, qty, cost_each, cost_type, total)]."""
    root_item.memo.clear()
    for k in root_item.kids: k.memo.clear()
    out = []
    for part in root_item.kids:
        qty = ev(part, 'Qty Formula', overrides)
        ce = ev(part, 'Cost Each', overrides)
        out.append((part.name, qty, ce, part.props['Cost Type'], qty * ce))
    return out
