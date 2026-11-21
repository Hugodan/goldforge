"""Build seed/sources.json: where each recipe item comes from (vendors, drops, objects, quests).

Source data: QuestieDB (https://github.com/questie/QuestieDB, GPL-3.0), data/Forever/*.lua.
QuestieDB's Forever item data matches Classic Era: it covers Classic recipes and their Classic
vendors/drops (still valid in Forever where the world did not change) but not Forever-only
recipes. Those get a source type from the game data in the app and are filled in over time by
what the Goldforge addon sees (vendors you open, patterns you loot).

    git clone --depth 1 https://github.com/questie/QuestieDB.git /tmp/QuestieDB
    python tools/build_sources.py /tmp/QuestieDB seed/sources.json

The output is a derived work of QuestieDB and is distributed under GPL-3.0 (see seed/sources.LICENSE).
"""

import json
import re
import sys
from collections import Counter

RECIPE_CLASS = 9
MAX_NPCS = 12


class LuaLiteral:
    """Parses a Lua table constructor that contains only literals (tables, strings, numbers,
    nil, booleans). Nothing is executed: QuestieDB's files are treated as data."""

    def __init__(self, text):
        self.s, self.i, self.n = text, 0, len(text)

    def ws(self):
        s, n = self.s, self.n
        while self.i < n:
            c = s[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif s.startswith("--", self.i):
                if s.startswith("--[[", self.i):
                    self.i = s.index("]]", self.i) + 2
                else:
                    j = s.find("\n", self.i)
                    self.i = n if j < 0 else j + 1
            else:
                break

    def value(self):
        self.ws()
        s, i = self.s, self.i
        c = s[i]
        if c == "{":
            return self.table()
        if c in "'\"":
            return self.short_string(c)
        if c == "[" and (s.startswith("[[", i) or s.startswith("[=", i)):
            return self.long_string()
        m = re.compile(r"-?(?:0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)").match(s, i)
        if m:
            self.i = m.end()
            t = m.group(0)
            return int(t, 16) if "x" in t.lower() else (float(t) if any(ch in t for ch in ".eE") else int(t))
        for word, val in (("nil", None), ("true", True), ("false", False)):
            if s.startswith(word, i):
                self.i = i + len(word)
                return val
        raise ValueError(f"unexpected {s[i:i + 30]!r} at {i}")

    def short_string(self, q):
        s, out = self.s, []
        self.i += 1
        while True:
            c = s[self.i]
            if c == q:
                self.i += 1
                return "".join(out)
            if c == "\\":
                nx = s[self.i + 1]
                if nx.isdigit():
                    m = re.compile(r"\d{1,3}").match(s, self.i + 1)
                    out.append(chr(int(m.group(0))))
                    self.i = m.end()
                    continue
                out.append({"n": "\n", "t": "\t", "r": "\r"}.get(nx, nx))
                self.i += 2
                continue
            out.append(c)
            self.i += 1

    def long_string(self):
        m = re.compile(r"\[(=*)\[").match(self.s, self.i)
        close = "]" + m.group(1) + "]"
        j = self.s.index(close, m.end())
        self.i = j + len(close)
        return self.s[m.end():j]

    def table(self):
        self.i += 1
        out, pos = {}, 1
        while True:
            self.ws()
            c = self.s[self.i]
            if c == "}":
                self.i += 1
                return out
            if c == "[" and not self.s.startswith("[[", self.i) and not self.s.startswith("[=", self.i):
                self.i += 1
                key = self.value()
                self.ws(); assert self.s[self.i] == "]"; self.i += 1
                self.ws(); assert self.s[self.i] == "="; self.i += 1
                out[key] = self.value()
            else:
                m = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)").match(self.s, self.i)
                if m:
                    self.i = m.end()
                    out[m.group(1)] = self.value()
                else:
                    out[pos] = self.value()
                    pos += 1
            self.ws()
            if self.s[self.i] in ",;":
                self.i += 1


def load_db(path, data_field):
    """Read the `QuestieDB.<field> = [[return {...}]]` literal from a QuestieDB file."""
    src = open(path, encoding="utf-8").read()
    m = re.search(r"QuestieDB\." + data_field + r"\s*=\s*\[(=*)\[", src)
    close = "]" + m.group(1) + "]"
    body = src[m.end():src.index(close, m.end())]
    body = body.strip()
    assert body.startswith("return"), "unexpected QuestieDB layout"
    return LuaLiteral(body[len("return"):]).value()


def lua_list(t):
    if not t:
        return []
    return [t[k] for k in sorted(k for k in t if isinstance(k, int))]


def field(row, idx):
    return row.get(idx) if row else None


def zone_names(path):
    names = {}
    for m in re.finditer(r"^\s*([A-Z0-9_]+)\s*=\s*(\d+)", open(path, encoding="utf-8").read(), re.M):
        sym, zid = m.group(1), int(m.group(2))
        if zid in names:
            continue
        words = sym.replace("_OLD", "").split("_")
        nice = " ".join(w.capitalize() if w not in ("OF", "THE", "AND") or i == 0 else w.lower()
                        for i, w in enumerate(words))
        nice = (nice.replace("Un Goro", "Un'Goro").replace("Zul Gurub", "Zul'Gurub").replace("Zul Farrak", "Zul'Farrak")
                    .replace("Onyxias", "Onyxia's").replace("Ahn Qiraj", "Ahn'Qiraj").replace("Razorfen Kraul", "Razorfen Kraul")
                    .replace("Nights Web", "Night's Web").replace("Champions Hall", "Champion's Hall"))
        names[zid] = nice
    return names


def main(qdb, out):
    items = load_db(f"{qdb}/data/Forever/foreverItemDB.lua", "itemData")
    npcs = load_db(f"{qdb}/data/Forever/foreverNpcDB.lua", "npcData")
    objects = load_db(f"{qdb}/data/Forever/foreverObjectDB.lua", "objectData")
    quests = load_db(f"{qdb}/data/Forever/foreverQuestDB.lua", "questData")
    zones = zone_names(f"{qdb}/src/corrections/enum/zones.lua")

    def npc_row(nid):
        n = npcs.get(nid)
        if not n:
            return None
        return [field(n, 1), field(n, 4) or 0, field(n, 5) or 0, zones.get(field(n, 9) or 0, ""),
                field(n, 13) or "", field(n, 14) or "", field(n, 6) or 0]

    out_items, need_npcs, need_obj, need_q = {}, set(), set(), set()
    for iid, it in items.items():
        if not it or field(it, 12) != RECIPE_CLASS:
            continue
        rec = {"name": field(it, 1)}
        vendors = lua_list(field(it, 14))
        if vendors:
            rec["v"] = vendors
            need_npcs.update(vendors)
        drops = lua_list(field(it, 2))
        if drops:
            levels, zc = [], Counter()
            for nid in drops:
                n = npcs.get(nid)
                if not n:
                    continue
                levels += [field(n, 4) or 0, field(n, 5) or 0]
                if field(n, 9):
                    zc[zones.get(field(n, 9), "")] += 1
            # rank 1 elite, 2 rare elite, 3 boss, 4 rare: keep bosses and rares first
            ranked = sorted(drops, key=lambda nid: (-(field(npcs.get(nid), 6) or 0), nid))
            rec["d"] = {"n": len(drops), "lv": [min(levels) if levels else 0, max(levels) if levels else 0],
                        "zones": [[z, c] for z, c in zc.most_common(4) if z], "npcs": ranked[:MAX_NPCS]}
            need_npcs.update(ranked[:MAX_NPCS])
        objs = lua_list(field(it, 3))
        if objs:
            rec["o"] = objs[:MAX_NPCS]
            need_obj.update(objs[:MAX_NPCS])
        qs = lua_list(field(it, 6))
        if qs:
            rec["q"] = qs
            need_q.update(qs)
        out_items[str(iid)] = rec

    npc_out = {str(n): r for n in sorted(need_npcs) if (r := npc_row(n))}
    obj_out = {str(o): [field(objects[o], 1), zones.get(field(objects[o], 5) or 0, "")] for o in sorted(need_obj) if objects.get(o)}
    q_out = {str(q): [field(quests[q], 1), field(quests[q], 5) or 0] for q in sorted(need_q) if quests.get(q)}
    data = {"source": "QuestieDB data/Forever (GPL-3.0), Classic Era item, NPC, object and quest data",
            "npcCols": ["name", "minLevel", "maxLevel", "zone", "friendlyTo", "title", "rank"],
            "items": out_items, "npcs": npc_out, "objects": obj_out, "quests": q_out}
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(out_items)} recipe items, {len(npc_out)} NPCs, {len(obj_out)} objects, {len(q_out)} quests -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
