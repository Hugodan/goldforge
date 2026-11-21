"""Turn raw auction house snapshots into compact listings and per-item price statistics."""

import math
from email.utils import parsedate_to_datetime

TIME_LEFT = {"SHORT": 0, "MEDIUM": 1, "LONG": 2, "VERY_LONG": 3}


def parse_http_date(value):
    if not value:
        return None
    try:
        return int(parsedate_to_datetime(value).timestamp())
    except (TypeError, ValueError):
        return None


def compact_listings(house_json, commodities_json):
    """{auction_id: [item_id, quantity, time_left_code, unit_price, is_commodity]}.

    Regular listings always carry quantity 1 and a total buyout; commodities carry
    stacks and a unit price. Listings without a buyout cannot be bought outright
    and are skipped, as the in-game scanners do.
    """
    out = {}
    for a in (house_json or {}).get("auctions") or []:
        buyout = a.get("buyout")
        if not buyout:
            continue
        qty = int(a.get("quantity") or 1)
        out[str(a["id"])] = [int(a["item"]["id"]), qty, TIME_LEFT.get(a.get("time_left"), 2),
                             int(math.ceil(buyout / qty)), 0]
    for a in (commodities_json or {}).get("auctions") or []:
        unit = a.get("unit_price")
        if not unit:
            continue
        out[str(a["id"])] = [int(a["item"]["id"]), int(a.get("quantity") or 1),
                             TIME_LEFT.get(a.get("time_left"), 2), int(unit), 1]
    return out


def group_by_item(listings):
    by_item = {}
    for _aid, (item, qty, _tl, unit, _c) in listings.items():
        by_item.setdefault(item, []).append((unit, qty))
    for v in by_item.values():
        v.sort()
    return by_item


def _price_at_fraction(units, total, fraction):
    """Unit price at which `fraction` of all units are cheaper or equal."""
    target = max(1, math.ceil(total * fraction))
    seen = 0
    for price, qty in units:
        seen += qty
        if seen >= target:
            return price
    return units[-1][0]


def _buy_cost(units, n):
    """Average unit price to buy the cheapest n units, or None if fewer are listed."""
    left, cost = n, 0
    for price, qty in units:
        take = min(qty, left)
        cost += take * price
        left -= take
        if left == 0:
            return int(round(cost / n))
    return None


def item_stats(units):
    """Statistics for one item from its sorted (unit_price, quantity) list.

    min   cheapest unit
    flr   cheapest unit after dropping lone bait listings (< 25% of the typical cheap price)
    mkt   market value: quantity-weighted mean of the cheapest 15% of units (after the same
          outlier guard), similar in spirit to TSM's DBMarket
    qty   units listed, n listings
    wall  units priced within 5% of flr (what you must undercut through)
    b10/b50/b200  average unit cost to buy that many units right now (slippage)
    """
    total = sum(q for _, q in units)
    n = len(units)
    ref = _price_at_fraction(units, total, 0.30)
    guard = ref * 0.25
    clean = [(p, q) for p, q in units if p >= guard] or units
    ctotal = sum(q for _, q in clean)
    target = max(1, math.ceil(ctotal * 0.15))
    taken, acc = 0, 0
    for p, q in clean:
        take = min(q, target - taken)
        acc += take * p
        taken += take
        if taken >= target:
            break
    mkt = int(round(acc / taken)) if taken else clean[0][0]
    flr = clean[0][0]
    wall = sum(q for p, q in clean if p <= flr * 1.05)
    return {
        "min": units[0][0],
        "flr": flr,
        "mkt": mkt,
        "qty": total,
        "n": n,
        "wall": wall,
        "b10": _buy_cost(units, 10),
        "b50": _buy_cost(units, 50),
        "b200": _buy_cost(units, 200),
    }


def estimate_sales(prev, curr):
    """Estimate units sold between two consecutive snapshots of one house.

    prev/curr are compact listings. Rules (conservative):
      * a listing that vanished with LONG/VERY_LONG time left counts as sold (MEDIUM counts half,
        SHORT is treated as expired);
      * a vanished listing that reappears as a new listing of the same item and quantity was
        cancelled and reposted, not sold;
      * a vanished commodity listing priced above a listing of the same item that survived
        cannot have been bought (buyers always take the cheapest units first), so it was cancelled;
      * a commodity listing whose quantity shrank sold the difference.
    Returns {item_id: [units_sold, copper_value]}.
    """
    sold = {}
    survivor_min = {}
    for aid, row in curr.items():
        if aid in prev and row[4] == 1:
            it, unit = row[0], row[3]
            if it not in survivor_min or unit < survivor_min[it]:
                survivor_min[it] = unit
    new_by_key = {}
    for aid, row in curr.items():
        if aid not in prev:
            key = (row[0], row[1])
            new_by_key[key] = new_by_key.get(key, 0) + 1

    def add(it, units, unit_price):
        s = sold.setdefault(it, [0.0, 0.0])
        s[0] += units
        s[1] += units * unit_price

    for aid, (it, qty, tl, unit, is_comm) in prev.items():
        now = curr.get(aid)
        if now is not None:
            if is_comm and now[1] < qty:
                add(it, qty - now[1], unit)
            continue
        if tl == 0:
            continue
        key = (it, qty)
        if new_by_key.get(key):
            new_by_key[key] -= 1
            continue
        if is_comm and it in survivor_min and unit > survivor_min[it]:
            continue
        add(it, qty * (1.0 if tl >= 2 else 0.5), unit)
    return sold
