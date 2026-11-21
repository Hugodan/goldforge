"""Game data for the web app: item names/quality/vendor prices and profession recipes.

Sources, in order of preference:
  1. wago.tools DB2 extracts of the newest WoW Forever client build (product "wowf"):
     SkillLineAbility, SpellName, SpellReagents, SpellEffect, ItemSparse, Item.
  2. The Battle.net static API (static-forever-{region}) for items wago could not name.
  3. seed/recipes.json shipped in the repo (so the app works even if wago is unreachable).
Item icons come from the Battle.net media API and are cached between runs.
"""

import csv
import io
import json
import re
import time
import urllib.request

WAGO_BUILDS = "https://wago.tools/api/builds"
WAGO_CSV = "https://wago.tools/db2/{table}/csv?build={build}&useHotfixes=1"
WAGO_TABLES = ["SkillLineAbility", "SpellName", "SpellReagents", "SpellEffect", "ItemSparse", "Item"]
CREATE_ITEM = 24
SKILL_LINES = {165: "leatherworking", 393: "skinning", 333: "enchanting"}
QUALITY = {"POOR": 0, "COMMON": 1, "UNCOMMON": 2, "RARE": 3, "EPIC": 4, "LEGENDARY": 5, "ARTIFACT": 6, "HEIRLOOM": 7}
BINDING = {"ON_ACQUIRE": 1, "ON_EQUIP": 2, "ON_USE": 3, "QUEST": 4, "TO_ACCOUNT": 7, "TO_BNETACCOUNT": 8}
ITEM_COLS = ["name", "q", "ilvl", "cls", "sub", "sell", "buy", "req", "bind", "inv"]
USER_AGENT = "goldforge-collector/1.0 (+https://github.com/Hugodan/goldforge)"


def _num(row, key, default=0):
    try:
        v = row.get(key, "")
        return int(float(v)) if v not in ("", None) else default
    except (TypeError, ValueError):
        return default


def _fetch(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def newest_forever_build(fetch=_fetch):
    data = json.loads(fetch(WAGO_BUILDS))
    best = None
    for product, entries in data.items():
        if not str(product).lower().startswith("wowf"):
            continue
        for e in entries if isinstance(entries, list) else []:
            v = str(e.get("version", ""))
            if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", v):
                key = tuple(int(x) for x in v.split("."))
                if best is None or key > best[0]:
                    best = (key, v)
    if not best:
        raise RuntimeError("wago.tools lists no WoW Forever (wowf) build")
    return best[1]


def read_wago_tables(build, fetch=_fetch, csv_dir=None):
    tables = {}
    for t in WAGO_TABLES:
        if csv_dir:
            with open(f"{csv_dir}/{t}.csv", encoding="utf-8-sig") as fh:
                text = fh.read()
        else:
            text = fetch(WAGO_CSV.format(table=t, build=build)).decode("utf-8-sig")
        tables[t] = list(csv.DictReader(io.StringIO(text)))
    return tables


def items_from_wago(tables, wanted=None):
    cls = {}
    for r in tables.get("Item", []):
        cls[_num(r, "ID")] = (_num(r, "ClassID"), _num(r, "SubclassID"), _num(r, "InventoryType"))
    out = {}
    for r in tables["ItemSparse"]:
        iid = _num(r, "ID")
        if wanted is not None and iid not in wanted:
            continue
        name = r.get("Display_lang") or ""
        if not name:
            continue
        c, s, inv = cls.get(iid, (-1, -1, _num(r, "InventoryType")))
        out[iid] = [name, _num(r, "OverallQualityID", 1), _num(r, "ItemLevel"), c, s,
                    _num(r, "SellPrice"), _num(r, "BuyPrice"), _num(r, "RequiredLevel"),
                    _num(r, "Bonding"), inv or _num(r, "InventoryType")]
    return out


def recipes_from_wago(tables, item_names):
    spell_name = {_num(r, "ID"): r.get("Name_lang", "") for r in tables["SpellName"]}
    reagents = {}
    for r in tables["SpellReagents"]:
        regs = []
        for i in range(8):
            iid, qty = _num(r, f"Reagent_{i}"), _num(r, f"ReagentCount_{i}")
            if iid > 0 and qty > 0:
                regs.append([iid, qty])
        if regs:
            reagents[_num(r, "SpellID")] = regs
    creates = {}
    for r in tables["SpellEffect"]:
        if _num(r, "Effect") == CREATE_ITEM and _num(r, "EffectItemType") > 0:
            sid, idx = _num(r, "SpellID"), _num(r, "EffectIndex")
            if sid not in creates or idx < creates[sid][2]:
                try:
                    count = max(1, int(round(float(r.get("EffectBasePointsF") or r.get("EffectBasePoints") or 1))))
                except ValueError:
                    count = 1
                creates[sid] = (_num(r, "EffectItemType"), count, idx)
    out = []
    for r in tables["SkillLineAbility"]:
        line = _num(r, "SkillLine")
        prof = SKILL_LINES.get(line)
        if not prof or prof == "enchanting":
            continue
        sid = _num(r, "Spell")
        made = creates.get(sid)
        regs = reagents.get(sid)
        if not made or not regs:
            continue
        name = item_names.get(made[0]) or spell_name.get(sid) or f"Spell {sid}"
        yellow = _num(r, "TrivialSkillLineRankLow")
        grey = _num(r, "TrivialSkillLineRankHigh")
        out.append({
            "s": sid, "p": prof, "n": name, "i": made[0], "m": made[1], "r": regs,
            "l": _num(r, "MinSkillLineRank"), "y": yellow, "g": grey,
            "auto": 1 if _num(r, "AcquireMethod") in (1, 2) else 0,
        })
    return out


def merge_seed(recipes, seed):
    """Fill learn-source details (trainer / pattern item / Merchant's Favor) from the seed file,
    and add seed recipes that wago did not produce."""
    by_spell = {r["s"]: r for r in recipes}
    for s in seed.get("recipes", []):
        r = by_spell.get(s["s"])
        if r is None:
            by_spell[s["s"]] = dict(s)
            continue
        for k in ("src", "pat", "patn", "favor", "new", "camp", "l"):
            if k in s and (k not in r or (k == "l" and r.get("l", 0) <= 1)):
                r[k] = s[k]
    return sorted(by_spell.values(), key=lambda r: (r["p"], r.get("l", 0), r["n"]))


def item_from_bnet(body):
    if not body or "name" not in body:
        return None
    name = body["name"]
    if isinstance(name, dict):
        name = name.get("en_GB") or name.get("en_US") or next(iter(name.values()), "")
    return [name,
            QUALITY.get((body.get("quality") or {}).get("type"), 1),
            int(body.get("level") or 0),
            int((body.get("item_class") or {}).get("id", -1)),
            int((body.get("item_subclass") or {}).get("id", -1)),
            int(body.get("sell_price") or 0),
            int(body.get("purchase_price") or 0),
            int(body.get("required_level") or 0),
            BINDING.get((body.get("binding") or {}).get("type"), 0),
            0]


def icon_from_media(body):
    """Full icon URL as Blizzard returns it (Forever icon URLs use file ids, not names)."""
    for a in (body or {}).get("assets") or []:
        if a.get("key") == "icon" and a.get("value"):
            return a["value"]
    return None


def fill_missing_items(bnet, items, wanted, budget, log=print):
    """Look up items wago could not name through the Battle.net item API (bounded per run)."""
    missing = [i for i in sorted(wanted) if i not in items]
    done = 0
    for iid in missing[:budget]:
        status, _h, body = bnet.item(iid)
        if status == 200:
            row = item_from_bnet(body)
            if row:
                items[iid] = row
        done += 1
    if missing:
        log(f"items: looked up {done} of {len(missing)} unnamed items through the Battle.net API")
    return items


def fill_icons(bnet, icons, wanted, budget, log=print):
    todo = [i for i in sorted(wanted) if str(i) not in icons or (icons[str(i)] and not str(icons[str(i)]).startswith("http"))]
    for iid in todo[:budget]:
        status, _h, body = bnet.item_media(iid)
        icons[str(iid)] = icon_from_media(body) if status == 200 else ""
        if status == 429:
            time.sleep(1)
    if todo:
        log(f"icons: fetched {min(len(todo), budget)} of {len(todo)} missing icons")
    return icons
