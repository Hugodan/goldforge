"""Offline tests: a fake Battle.net server and tiny wago.tools tables. Run with
    cd collector && python -m pytest -q
"""

import email.utils
import gzip
import io
import json
import os
import shutil
import sys
import tempfile
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(HERE))

from goldforge_collector import auctions, gamedata, run  # noqa: E402
from goldforge_collector.bnet import Bnet  # noqa: E402


# ----------------------------------------------------------------------------- auctions
def test_compact_and_stats():
    house = {"auctions": [
        {"id": 1, "item": {"id": 500}, "buyout": 1000, "quantity": 1, "time_left": "LONG"},
        {"id": 2, "item": {"id": 500}, "bid": 50, "quantity": 1, "time_left": "LONG"},  # no buyout: skipped
    ]}
    comm = {"auctions": [
        {"id": 10, "item": {"id": 8170}, "quantity": 20, "unit_price": 2000, "time_left": "VERY_LONG"},
        {"id": 11, "item": {"id": 8170}, "quantity": 5, "unit_price": 2050, "time_left": "LONG"},
        {"id": 12, "item": {"id": 8170}, "quantity": 100, "unit_price": 2500, "time_left": "LONG"},
        {"id": 13, "item": {"id": 8170}, "quantity": 1, "unit_price": 1, "time_left": "SHORT"},  # bait
    ]}
    c = auctions.compact_listings(house, comm)
    assert set(c) == {"1", "10", "11", "12", "13"}
    s = auctions.item_stats(auctions.group_by_item(c)[8170])
    assert s["min"] == 1 and s["flr"] == 2000          # bait ignored for the floor
    assert s["qty"] == 126 and s["n"] == 4
    assert s["wall"] == 25                              # 2000 and 2050 are within 5%
    assert s["b10"] == round((1 + 9 * 2000) / 10)       # buying really does take the bait unit first
    assert s["b50"] == round((1 + 20 * 2000 + 5 * 2050 + 24 * 2500) / 50)
    assert s["b200"] is None
    assert 2000 <= s["mkt"] <= 2050


def test_sales_rules():
    prev = {
        "1": [8170, 20, 3, 2000, 1],   # shrinks to 12 -> 8 sold
        "2": [8170, 10, 2, 2600, 1],   # vanished but pricier than surviving #1 -> cancelled
        "3": [500, 1, 3, 9000, 0],     # vanished, long -> sold
        "4": [501, 1, 0, 100, 0],      # vanished, short -> expired
        "5": [502, 1, 3, 700, 0],      # vanished and reposted (new id 9, same qty) -> not sold
        "6": [503, 1, 1, 400, 0],      # vanished, medium -> half
    }
    curr = {"1": [8170, 12, 3, 2000, 1], "9": [502, 1, 3, 650, 0]}
    s = auctions.estimate_sales(prev, curr)
    assert s[8170] == [8, 16000]
    assert s[500] == [1.0, 9000]
    assert 501 not in s and 502 not in s
    assert s[503] == [0.5, 200]


# ----------------------------------------------------------------------------- fake API
class FakeResponse(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        raw = gzip.compress(json.dumps(body).encode())
        super().__init__(raw)
        self.status = status
        self.headers = {"Content-Encoding": "gzip", **(headers or {})}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeBlizzard:
    def __init__(self):
        self.snapshot = 0
        self.lm = [email.utils.formatdate(1795250000, usegmt=True), email.utils.formatdate(1795253600, usegmt=True)]
        self.calls = []

    def houses(self):
        if self.snapshot == 0:
            return {"auctions": [{"id": 1, "item": {"id": 4304}, "buyout": 700, "quantity": 1, "time_left": "LONG"},
                                 {"id": 2, "item": {"id": 99999}, "buyout": 50000, "quantity": 1, "time_left": "VERY_LONG"}]}, \
                   {"auctions": [{"id": 20, "item": {"id": 8170}, "quantity": 50, "unit_price": 2000, "time_left": "VERY_LONG"},
                                 {"id": 21, "item": {"id": 2318}, "quantity": 200, "unit_price": 40, "time_left": "LONG"}]}
        return {"auctions": [{"id": 1, "item": {"id": 4304}, "buyout": 700, "quantity": 1, "time_left": "LONG"}]}, \
               {"auctions": [{"id": 20, "item": {"id": 8170}, "quantity": 30, "unit_price": 2000, "time_left": "VERY_LONG"},
                             {"id": 21, "item": {"id": 2318}, "quantity": 200, "unit_price": 40, "time_left": "LONG"}]}

    def __call__(self, req, timeout=0):
        url = req.full_url
        self.calls.append(url)
        if "oauth.battle.net" in url:
            return FakeResponse({"access_token": "t", "expires_in": 86399})
        lm = self.lm[self.snapshot]
        if "/auctions/" in url:
            ims = req.headers.get("If-modified-since")
            if ims == lm:
                raise urllib.error.HTTPError(url, 304, "Not Modified", {}, None)
            reg, comm = self.houses()
            if "/commodities" in url:
                return FakeResponse(comm, headers={"Last-Modified": lm})
            return FakeResponse({**reg, "name": "Alliance Auction House"}, headers={"Last-Modified": lm})
        if "/data/wow/media/item/" in url:
            iid = url.split("/media/item/")[1].split("?")[0]
            return FakeResponse({"assets": [{"key": "icon", "value": f"https://render.worldofwarcraft.com/eu/icons/56/icon_{iid}.jpg"}]})
        if "/data/wow/item/" in url:
            iid = int(url.split("/data/wow/item/")[1].split("?")[0])
            return FakeResponse({"id": iid, "name": f"Fake {iid}", "quality": {"type": "UNCOMMON"}, "level": 58,
                                 "item_class": {"id": 4}, "item_subclass": {"id": 2}, "sell_price": 1234,
                                 "binding": {"type": "ON_EQUIP"}})
        raise urllib.error.HTTPError(url, 404, "nf", {}, None)


def write_csvs(d):
    files = {
        "SkillLineAbility": "ID,SkillLine,Spell,MinSkillLineRank,TrivialSkillLineRankLow,TrivialSkillLineRankHigh,AcquireMethod\n"
                            "1,165,19047,0,260,280,0\n2,393,555,0,10,20,0\n",
        "SpellName": "ID,Name_lang\n19047,Cured Rugged Hide\n555,Camp Chair\n",
        "SpellReagents": "ID,SpellID,Reagent_0,Reagent_1,ReagentCount_0,ReagentCount_1\n1,19047,8171,15409,1,1\n2,555,2318,0,3,0\n",
        "SpellEffect": "ID,SpellID,Effect,EffectItemType,EffectBasePointsF,EffectIndex\n1,19047,24,15407,1,0\n2,555,24,279999,1,0\n",
        "ItemSparse": "ID,Display_lang,OverallQualityID,ItemLevel,SellPrice,BuyPrice,RequiredLevel,Bonding,InventoryType\n"
                      "8170,Rugged Leather,1,50,500,2000,0,0,0\n2318,Light Leather,1,10,15,60,0,0,0\n"
                      "4304,Thick Leather,1,40,150,600,0,0,0\n8171,Rugged Hide,1,50,1000,4000,0,0,0\n"
                      "15407,Cured Rugged Hide,1,55,1500,6000,0,0,0\n15409,Refined Deeprock Salt,1,45,250,1000,0,0,0\n"
                      "77777,Pattern: Camp Chair,2,20,100,400,0,1,0\n",
        "Item": "ID,ClassID,SubclassID,InventoryType,IconFileDataID\n8170,7,6,0,1\n",
    }
    for k, v in files.items():
        with open(os.path.join(d, k + ".csv"), "w") as fh:
            fh.write(v)


def test_end_to_end():
    tmp = tempfile.mkdtemp()
    try:
        csv_dir = os.path.join(tmp, "csv")
        os.makedirs(csv_dir)
        write_csvs(csv_dir)
        cfg = json.load(open(os.path.join(ROOT, "config.json")))
        cfg["houses"] = {"111": {"label": "x", "faction": "Alliance", "detail": True}}
        cfg_path = os.path.join(tmp, "config.json")
        json.dump(cfg, open(cfg_path, "w"))
        shutil.copytree(os.path.join(ROOT, "site", "static"), os.path.join(tmp, "site", "static"))
        shutil.copytree(os.path.join(ROOT, "seed"), os.path.join(tmp, "seed"))
        fake = FakeBlizzard()
        bnet = Bnet("id", "secret", "eu", opener=fake)
        args = ["--config", cfg_path, "--state", os.path.join(tmp, "state"), "--out", os.path.join(tmp, "out"),
                "--csv-dir", csv_dir, "--force-gamedata"]
        assert run.main(args, bnet=bnet) == 0
        out = os.path.join(tmp, "out")
        prices = json.load(open(os.path.join(out, "prices-111.json")))
        assert prices["items"]["8170"][0] == 2000
        recipes = json.load(open(os.path.join(out, "recipes.json")))["recipes"]
        names = {r["n"] for r in recipes}
        assert "Cured Rugged Hide" in names and "Camp Chair" in names
        chair = next(r for r in recipes if r["n"] == "Camp Chair")
        assert chair["pat"] == 77777 and chair["src"] == "item"
        assert prices["cols"][-1] == "bq" and prices["items"]["8170"][-1][0] == 2000
        items = json.load(open(os.path.join(out, "items.json")))["items"]
        assert items["8170"][0] == "Rugged Leather" and items["8170"][3] == 7
        assert items["99999"][0] == "Fake 99999"          # filled from the Battle.net item API
        icons = json.load(open(os.path.join(out, "icons.json")))
        assert icons.get("8170") == "https://render.worldofwarcraft.com/eu/icons/56/icon_8170.jpg"

        # same snapshot again -> 304, nothing to publish
        bnet2 = Bnet("id", "secret", "eu", opener=fake)
        assert run.main(args[:-3], bnet=bnet2) == 0
        # next hourly snapshot: 20 Rugged Leather and the 5g item sold
        fake.snapshot = 1
        bnet3 = Bnet("id", "secret", "eu", opener=fake)
        assert run.main(args[:-3], bnet=bnet3) == 0
        st = json.load(gzip.open(os.path.join(tmp, "state", "market", "111.json.gz"), "rt"))
        day = list(st["daily_sales"]["8170"])[0]
        assert st["daily_sales"]["8170"][day][0] == 20
        assert st["daily_sales"]["99999"][day][0] == 1
        hist = json.load(open(os.path.join(out, "history-111.json")))
        assert len(hist["items"]["8170"]["h"]) == 2
        meta = json.load(open(os.path.join(out, "meta.json")))
        assert meta["houses"]["111"]["snapshot"] == 1795253600

        # an older collector overwrote recipes.json with a shorter list -> rebuilt on the next run
        rpath = os.path.join(tmp, "state", "recipes.json")
        full = len(json.load(open(rpath)))
        json.dump(json.load(open(rpath))[:1], open(rpath, "w"))
        assert run.main(args[:-1], bnet=Bnet("id", "secret", "eu", opener=fake)) == 0
        assert len(json.load(open(rpath))) == full
    finally:
        shutil.rmtree(tmp)


def test_seed_merge_keeps_learn_source():
    wago = [{"s": 1, "p": "leatherworking", "n": "A", "i": 2, "m": 1, "r": [[3, 1]], "l": 1, "y": 10, "g": 20}]
    seed = {"recipes": [{"s": 1, "n": "A", "src": "item", "pat": 77, "patn": "Pattern: A", "l": 150},
                        {"s": 9, "p": "leatherworking", "n": "B", "i": 5, "m": 1, "r": [[3, 2]]}]}
    merged = gamedata.merge_seed(wago, seed)
    a = next(r for r in merged if r["s"] == 1)
    assert a["pat"] == 77 and a["l"] == 150
    assert any(r["s"] == 9 for r in merged)
