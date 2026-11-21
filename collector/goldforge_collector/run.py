"""Collector entry point.

    python -m goldforge_collector.run --config config.json --state state --out out/data [--force-gamedata]

Reads BNET_CLIENT_ID / BNET_CLIENT_SECRET from the environment. Writes the web app's data
files into --out and keeps everything it needs between runs in --state. When Blizzard has no
new snapshot for any house (HTTP 304) and game data is fresh, it writes nothing and reports
changed=false so the workflow can skip deploying.
"""

import argparse
import datetime as dt
import json
import os
import sys
import time

from . import auctions, gamedata, store
from .bnet import Bnet

DETAIL_COLS = ["min", "flr", "mkt", "qty", "n", "wall", "b10", "b50", "b200", "sold1", "spd", "sp7", "avg7", "tr1", "bq"]
BASIC_COLS = ["min", "flr", "mkt", "qty", "n"]
MAX_GAP = 75 * 60          # snapshots further apart than this are not diffed for sales
HOURLY_KEEP = 72 * 3600
DAILY_KEEP = 30
SALES_DAYS = 8


def log(msg):
    print(msg, flush=True)


def day_of(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d")


def set_output(key, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"{key}={value}\n")


def relevant_items(recipes, constants):
    ids = set()
    for r in recipes:
        ids.add(r["i"])
        for iid, _ in r["r"]:
            ids.add(iid)
    ids.update(int(k) for k in constants.get("vendorGoods", {}))
    ids.update(constants.get("enchantMats", []))
    sk = constants.get("skinning", {})
    for t in sk.get("tiers", []):
        ids.update(i for i, _ in t["out"])
    ids.update(s["item"] for s in sk.get("special", []))
    ids.update(sk.get("scarce", []))
    ids.update(int(k) for k in constants.get("foreverMaterials", {}))
    ids.update(r["pat"] for r in recipes if r.get("pat"))
    return ids


# --------------------------------------------------------------------------- houses
def fetch_house(bnet, ruleset, house_id, last_modified):
    status, hdrs, body = bnet.house(ruleset, house_id, if_modified_since=last_modified)
    if status == 304:
        return None
    if status != 200:
        log(f"house {house_id}: HTTP {status}, treated as empty")
        return {"listings": {}, "lm": hdrs.get("last-modified"), "ts": int(time.time()), "name": None}
    c_status, c_hdrs, c_body = bnet.commodities(ruleset, house_id)
    if c_status != 200:
        c_body = None
    lm = hdrs.get("last-modified") or c_hdrs.get("last-modified")
    ts = auctions.parse_http_date(lm) or int(time.time())
    listings = auctions.compact_listings(body, c_body)
    name = (body or {}).get("name")
    if isinstance(name, dict):
        name = name.get("en_GB") or name.get("en_US") or next(iter(name.values()), None)
    return {"listings": listings, "lm": lm, "ts": ts, "name": name}


def update_sales(state_dir, house_id, snap, rel_ids):
    """Diff against the previous snapshot of this house and roll the sales/price state forward."""
    prev = store.load(f"{state_dir}/snap/{house_id}.json.gz")
    st = store.load(f"{state_dir}/market/{house_id}.json.gz") or {}
    sales_recent = st.get("recent", {})      # item -> [[t, units, copper], ...] (26h)
    sales_daily = st.get("daily_sales", {})  # item -> {day: [units, copper]}
    coverage = st.get("coverage", {})        # day -> hours covered by valid diffs
    coverage_recent = st.get("coverage_recent", [])  # [[t, hours]]
    price_daily = st.get("price_daily", {})  # item -> {day: [sum_mkt, n, min]}
    hourly = st.get("hourly", {})            # item -> [[t, min, mkt, qty]]
    t = snap["ts"]
    today = day_of(t)

    if prev and 0 < t - prev.get("ts", 0) <= MAX_GAP:
        hours = min(1.25, (t - prev["ts"]) / 3600)
        sold = auctions.estimate_sales(prev["a"], snap["listings"])
        for it, (u, v) in sold.items():
            k = str(it)
            sales_recent.setdefault(k, []).append([t, round(u, 2), int(v)])
            d = sales_daily.setdefault(k, {}).setdefault(today, [0, 0])
            d[0] = round(d[0] + u, 2)
            d[1] = int(d[1] + v)
        coverage[today] = round(coverage.get(today, 0) + hours, 3)
        coverage_recent.append([t, hours])
        log(f"house {house_id}: estimated {sum(u for u, _ in sold.values()):.0f} units sold since previous snapshot")
    elif prev:
        log(f"house {house_id}: previous snapshot too old for a sales diff ({(t - prev.get('ts', 0)) / 60:.0f} min)")

    by_item = auctions.group_by_item(snap["listings"])
    stats = {it: auctions.item_stats(units) for it, units in by_item.items()}
    curves = {it: auctions.buy_curve(by_item[it]) for it in by_item if it in rel_ids}

    for it, s in stats.items():
        k = str(it)
        d = price_daily.setdefault(k, {}).setdefault(today, [0, 0, s["min"]])
        d[0] += s["mkt"]
        d[1] += 1
        d[2] = min(d[2], s["min"])
        if it in rel_ids:
            hourly.setdefault(k, []).append([t, s["min"], s["mkt"], s["qty"]])

    # trim
    cut_recent = t - 26 * 3600
    for k in list(sales_recent):
        sales_recent[k] = [e for e in sales_recent[k] if e[0] >= cut_recent]
        if not sales_recent[k]:
            del sales_recent[k]
    coverage_recent = [e for e in coverage_recent if e[0] >= cut_recent]
    keep_days = {day_of(t - i * 86400) for i in range(SALES_DAYS)}
    for k in list(sales_daily):
        sales_daily[k] = {d: v for d, v in sales_daily[k].items() if d in keep_days}
        if not sales_daily[k]:
            del sales_daily[k]
    coverage = {d: v for d, v in coverage.items() if d in keep_days}
    keep_price_days = {day_of(t - i * 86400) for i in range(DAILY_KEEP)}
    for k in list(price_daily):
        price_daily[k] = {d: v for d, v in price_daily[k].items() if d in keep_price_days}
        if not price_daily[k]:
            del price_daily[k]
    cut_hourly = t - HOURLY_KEEP
    for k in list(hourly):
        hourly[k] = [e for e in hourly[k] if e[0] >= cut_hourly]
        if not hourly[k]:
            del hourly[k]

    st = {"recent": sales_recent, "daily_sales": sales_daily, "coverage": coverage,
          "coverage_recent": coverage_recent, "price_daily": price_daily, "hourly": hourly, "ts": t}
    store.save(f"{state_dir}/market/{house_id}.json.gz", st)
    store.save(f"{state_dir}/snap/{house_id}.json.gz", {"ts": t, "a": snap["listings"]})
    return stats, st, curves


def detail_rows(stats, st, t, curves=None):
    yesterday = day_of(t - 86400)
    last7 = [day_of(t - i * 86400) for i in range(7)]
    cov7 = sum(st["coverage"].get(d, 0) for d in last7)
    cov24 = sum(h for _, h in st["coverage_recent"] if _ >= t - 24 * 3600)
    rows = {}
    for it, s in stats.items():
        k = str(it)
        sold1 = spd = sp7 = None
        if cov24 >= 6:
            u = sum(e[1] for e in st["recent"].get(k, []) if e[0] >= t - 24 * 3600)
            sold1 = round(u * 24 / cov24, 1)
        if cov7 >= 6:
            days = st["daily_sales"].get(k, {})
            u = sum(days.get(d, [0, 0])[0] for d in last7)
            v = sum(days.get(d, [0, 0])[1] for d in last7)
            spd = round(u * 24 / cov7, 1)
            sp7 = int(v / u) if u >= 1 else None
        pdays = st["price_daily"].get(k, {})
        vals = [pdays[d][0] / pdays[d][1] for d in last7 if d in pdays and pdays[d][1]]
        avg7 = int(sum(vals) / len(vals)) if vals else None
        tr1 = None
        if yesterday in pdays and pdays[yesterday][1]:
            y = pdays[yesterday][0] / pdays[yesterday][1]
            if y > 0:
                tr1 = round((s["mkt"] - y) / y * 100, 1)
        rows[k] = [s["min"], s["flr"], s["mkt"], s["qty"], s["n"], s["wall"], s["b10"], s["b50"], s["b200"],
                   sold1, spd, sp7, avg7, tr1, (curves or {}).get(it)]
    return rows, {"coverage7h": round(cov7, 1), "coverage24h": round(cov24, 1)}


def history_file(st, rel_ids):
    out = {}
    for k in {str(i) for i in rel_ids}:
        pdays = st["price_daily"].get(k)
        if not pdays and k not in st["hourly"]:
            continue
        sales = st["daily_sales"].get(k, {})
        d = [[day, int(v[0] / v[1]) if v[1] else None, v[2], sales.get(day, [0, 0])[0]]
             for day, v in sorted((pdays or {}).items())]
        h = [[e[0], e[1], e[2], e[3]] for e in st["hourly"].get(k, [])]
        out[k] = {"d": d, "h": h}
    return out


# --------------------------------------------------------------------------- game data
def refresh_gamedata(cfg, state_dir, root, bnet, wanted, force=False, csv_dir=None, fetch=None):
    gd = store.load(f"{state_dir}/gamedata.json") or {}
    items = {int(k): v for k, v in (store.load(f"{state_dir}/items.json.gz") or {}).items()}
    recipes = store.load(f"{state_dir}/recipes.json") or []
    seed_recipes = store.load(f"{root}/seed/recipes.json") or {"recipes": []}
    age_h = (time.time() - gd.get("checked", 0)) / 3600
    lines = sorted(gamedata.SKILL_LINES)
    if gd.get("lines") != lines:
        force = True
    if force or not recipes or age_h >= cfg.get("gamedata_refresh_hours", 24):
        try:
            kw = {"fetch": fetch} if fetch else {}
            build = "local" if csv_dir else gamedata.newest_forever_build(**kw)
            if force or csv_dir or build != gd.get("build") or not recipes:
                log(f"gamedata: reading wago.tools tables for Forever build {build}")
                tables = gamedata.read_wago_tables(build, csv_dir=csv_dir, **kw)
                all_names = {int(r["ID"]): r.get("Display_lang", "") for r in tables["ItemSparse"] if r.get("ID")}
                wago_recipes = gamedata.recipes_from_wago(tables, all_names)
                recipes = gamedata.merge_seed(wago_recipes, seed_recipes)
                gamedata.link_recipe_items(recipes, all_names)
                rel = relevant_items(recipes, cfg["_constants"])
                items.update(gamedata.items_from_wago(tables, wanted | rel))
                gd["build"] = build
                gd["source"] = f"wago.tools wowf {build}"
                gd["lines"] = lines
                log(f"gamedata: {len(wago_recipes)} recipes from wago, {len(recipes)} after merging the seed")
            gd["checked"] = int(time.time())
        except Exception as e:  # network or format problems must not stop prices from updating
            log(f"gamedata: wago.tools unavailable ({e}); keeping previous data")
            if not recipes:
                recipes = seed_recipes["recipes"]
                gd["source"] = "seed"
            gd["checked"] = int(time.time()) - int(cfg.get("gamedata_refresh_hours", 24) * 3600) + 3 * 3600
    if not items:
        seed_items = (store.load(f"{root}/seed/items.json") or {}).get("items", {})
        for k, v in seed_items.items():
            items[int(k)] = [v.get("name", ""), v.get("q", 1), 0, v.get("cls", -1), -1, 0, 0, 0, 0, 0]
    rel = relevant_items(recipes, cfg["_constants"])
    if bnet:
        try:
            gamedata.fill_missing_items(bnet, items, wanted | rel, cfg.get("item_lookup_budget", 1500), log=log, first=wanted)
        except Exception as e:
            log(f"items: Battle.net item lookups failed ({e})")
    store.save(f"{state_dir}/gamedata.json", gd)
    store.save(f"{state_dir}/items.json.gz", {str(k): v for k, v in items.items()})
    store.save(f"{state_dir}/recipes.json", recipes)
    icons = store.load(f"{state_dir}/icons.json") or {}
    if bnet:
        try:
            gamedata.fill_icons(bnet, icons, rel, cfg.get("icon_budget", 1200), log=log)
        except Exception as e:
            log(f"icons: lookups failed ({e})")
        store.save(f"{state_dir}/icons.json", icons)
    return gd, items, recipes, icons, rel


# --------------------------------------------------------------------------- main
def main(argv=None, bnet=None, wago_fetch=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--state", default="state")
    ap.add_argument("--out", default="out/data")
    ap.add_argument("--force-gamedata", action="store_true")
    ap.add_argument("--force-publish", action="store_true")
    ap.add_argument("--csv-dir", help="offline wago CSVs (tests)")
    args = ap.parse_args(argv)

    root = os.path.dirname(os.path.abspath(args.config))
    cfg = store.load(args.config)
    cfg["_constants"] = store.load(os.path.join(root, "site", "static", "constants.json")) or {}
    state = args.state
    os.makedirs(state, exist_ok=True)

    bnet = bnet or Bnet(os.environ.get("BNET_CLIENT_ID"), os.environ.get("BNET_CLIENT_SECRET"), cfg.get("region", "eu"))
    lastmod = store.load(f"{state}/lastmod.json") or {}
    meta_prev = store.load(f"{state}/meta.json") or {"houses": {}}
    recipes_prev = store.load(f"{state}/recipes.json") or []
    rel_ids = relevant_items(recipes_prev, cfg["_constants"])

    changed = []
    house_meta = meta_prev.get("houses", {})
    for hid_s, hcfg in cfg["houses"].items():
        hid = int(hid_s)
        snap = fetch_house(bnet, cfg.get("ruleset", 2), hid, lastmod.get(hid_s))
        if snap is None:
            log(f"house {hid}: unchanged (304)")
            continue
        changed.append(hid)
        lastmod[hid_s] = snap["lm"]
        if hcfg.get("detail"):
            stats, st, curves = update_sales(state, hid, snap, rel_ids)
            rows, cov = detail_rows(stats, st, snap["ts"], curves)
            store.save(f"{state}/prices/{hid}.json", {"house": hid, "snapshot": snap["ts"], "cols": DETAIL_COLS, "items": rows})
            store.save(f"{state}/history/{hid}.json", {"house": hid, "snapshot": snap["ts"], "items": history_file(st, rel_ids)})
        else:
            stats = {it: auctions.item_stats(u) for it, u in auctions.group_by_item(snap["listings"]).items()}
            rows = {str(it): [s[c] for c in BASIC_COLS] for it, s in stats.items()}
            cov = {}
            store.save(f"{state}/prices/{hid}.json", {"house": hid, "snapshot": snap["ts"], "cols": BASIC_COLS, "items": rows})
        house_meta[hid_s] = {**hcfg, "name": snap["name"], "snapshot": snap["ts"], "fetched": int(time.time()),
                             "items": len(rows), "listings": len(snap["listings"]), **cov}
        log(f"house {hid}: snapshot {dt.datetime.fromtimestamp(snap['ts'], dt.timezone.utc):%Y-%m-%d %H:%M} UTC, "
            f"{len(snap['listings'])} listings, {len(rows)} items")
    store.save(f"{state}/lastmod.json", lastmod)

    wanted = set()
    for hid_s, h in cfg["houses"].items():
        if h.get("detail"):
            p = store.load(f"{state}/prices/{hid_s}.json") or {"items": {}}
            wanted.update(int(k) for k in p["items"])
    gd_before = store.load(f"{state}/gamedata.json") or {}
    gd, items, recipes, icons, rel = refresh_gamedata(cfg, state, root, bnet, wanted, force=args.force_gamedata,
                                                      csv_dir=args.csv_dir, fetch=wago_fetch)
    gamedata_changed = (gd.get("build") != gd_before.get("build") or gd.get("lines") != gd_before.get("lines")
                        or args.force_gamedata)

    if not changed and not gamedata_changed and not args.force_publish and os.path.exists(f"{state}/meta.json"):
        log("nothing new from Blizzard; skipping publish")
        set_output("changed", "false")
        return 0

    out = args.out
    os.makedirs(out, exist_ok=True)
    for hid_s in cfg["houses"]:
        p = store.load(f"{state}/prices/{hid_s}.json")
        if p:
            store.save(f"{out}/prices-{hid_s}.json", p)
        h = store.load(f"{state}/history/{hid_s}.json")
        if h:
            store.save(f"{out}/history-{hid_s}.json", h)
    keep = wanted | rel
    store.save(f"{out}/items.json", {"cols": gamedata.ITEM_COLS,
                                      "items": {str(k): v for k, v in items.items() if k in keep}})
    store.save(f"{out}/recipes.json", {"source": gd.get("source", "seed"), "build": gd.get("build"), "recipes": recipes})
    store.save(f"{out}/icons.json", {k: v for k, v in icons.items() if v})
    meta = {"generated": int(time.time()), "region": cfg.get("region", "eu"),
            "namespace": f"dynamic-forever-{cfg.get('region', 'eu')}", "ruleset": cfg.get("ruleset", 2),
            "primary": cfg.get("primary"), "neutral": cfg.get("neutral"), "houses": house_meta,
            "gamedata": {"build": gd.get("build"), "source": gd.get("source", "seed")},
            "apiRequests": bnet.requests}
    store.save(f"{state}/meta.json", meta)
    store.save(f"{out}/meta.json", meta, pretty=True)
    log(f"published {len(changed)} changed house(s); {bnet.requests} API requests")
    set_output("changed", "true")
    return 0


if __name__ == "__main__":
    sys.exit(main())
