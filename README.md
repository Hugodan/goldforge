# Goldforge

A goldmaking companion for **WoW Forever, EU Normal, Alliance**, built around Skinning, Leatherworking
and disenchanting. Prices come from Blizzard's own auction house snapshots, refreshed about every hour,
and every profit figure counts the hidden costs: the house cut, deposits lost on listings that don't
sell, buying slippage on big orders, and what your own materials could have sold for.

**App:** https://hugodan.github.io/goldforge/ (after the setup below)

| Tab | What it answers |
|---|---|
| Gold Board | The best thing to do right now: top craft by gold/day, best farm, best disenchant and neutral-AH flips, what your bags are worth |
| Leatherworking | Every recipe's cost (cheapest of AH, vendor, crafting it yourself or your bags), best exit (AH, neutral AH, disenchant, vendor), profit, margin, sales per day |
| Skinning | Gold per hour by leather tier and special target, with Bountiful Harvest, plus your own logged yields per mob, and whether to sell leather raw or craft it |
| Disenchanting | Craft → mail to your enchanter → disenchant, gear on the AH worth more as mats, and your alt's real disenchant results |
| Neutral AH | Where to sell your goods and cross-faction flips through the Blackwater AH (15% cut, 5× deposit) |
| My Bags | Best exit for everything in your bags and bank on all characters |
| Ledger | Sales, purchases and lost deposits read by the addon, plus manual entries |
| Market | Any item on your AH: floor, market value, 7-day average, trend, sales per day |

## How it works

```
Blizzard Game Data API ──hourly snapshot──▶ GitHub Actions collector (every 15 min, If-Modified-Since)
wago.tools (Forever client data) ──daily──▶        │  computes prices, sales, history
                                                    ▼
                                    GitHub Pages: site + data/*.json ──▶ the app (PC or phone)
In-game Goldforge addon ──/gf export──▶ paste into the app (recipes, bags, ledger, skinning, disenchants)
```

* **Your market.** WoW Forever has no realms: there is one auction house per region, ruleset and faction.
  Blizzard doesn't label them. **#111 is EU Normal Alliance** by its ID group (EU Normal Horde #114 has
  been confirmed by matching in-game scans, and the IDs come in Alliance/Horde/Blackwater groups). Its
  neutral Blackwater house is #117. Check it under **Settings → House check**. With the addon, searching a
  few commodities at the AH and importing does the check automatically.
* **"Live".** Blizzard publishes each house about once an hour, at about :23 past the hour for the EU
  houses. The collector checks at :26 (then :41, :56 and :11 as cheap retries) and deploys a couple of
  minutes later. The app reloads new prices by itself every 4 minutes. The header shows the snapshot's age.
* **Sales per day** are estimated by comparing consecutive snapshots. A listing that vanished with lots of
  time left counts as sold. Listings that were cancelled and reposted don't count. Commodity listings
  priced above a surviving cheaper listing can't have been bought, so they don't count either. It needs
  about 6 hours of history before sales numbers appear, and gets better over 7 days.

## Setup (once, about 10 minutes)

1. **Battle.net API key.** Go to https://develop.battle.net/access/clients, sign in, and choose
   *Create client*. Give it any name ("Goldforge") and any redirect URL (`http://localhost`), and leave the
   service URL empty. Copy the **Client ID** and **Client Secret**.
2. **Repo secrets.** In this repo, open *Settings → Secrets and variables → Actions → New repository
   secret* and add `BNET_CLIENT_ID` and `BNET_CLIENT_SECRET`.
3. **Pages.** In *Settings → Pages*, set *Build and deployment → Source* to **GitHub Actions**.
4. **First run.** In *Actions → Collect prices → Run workflow*, tick *Re-read recipes and items* and run it.
   The first run takes a few minutes because it downloads Forever's item/recipe tables and icons. After
   that it runs on its own every 15 minutes.
5. Open **https://hugodan.github.io/goldforge/**. On your phone, use *Add to Home Screen*.
6. **Addon.** Copy `addon/Goldforge` into `World of Warcraft\_forever_\Interface\AddOns\` and restart the game.
   On your Hunter, open the Leatherworking window once. On each character, open the bank and the mailbox.
   Then type `/gf export`, press Ctrl+C, and paste the text into the app under **Settings → Goldforge addon**.
   Do this again after a selling session to update the ledger.

### What the addon records

Everything stays in your own SavedVariables until you export it. Nothing is sent anywhere.

* known recipes with exact reagents (any profession window you open)
* bags, bank and gold per character, and profession skill
* auction sales, cut and deposit (from mailbox invoices), expired and cancelled auctions, AH purchases
* the deposit you paid when posting, so lost deposits on expired auctions are exact
* prices you see while searching the AH (for the house check)
* vendor prices of trade goods (thread, dyes, salt) when you open a merchant
* every skin: which mob, which zone, and exactly what it gave. Your real yields and skins per hour
  replace the Classic baselines on the Skinning tab.
* every disenchant on your enchanter: item and results. After 3 disenchants of an item, your real results
  replace the Classic disenchant table.

Commands: `/gf export`, `/gf status`, `/gf reset`.

## How the numbers are calculated

* **List price**: floor − 1c by default (Settings: market value, or the average price it actually sold for
  over 7 days). The *floor* ignores lone bait listings priced below 25% of the typical cheap price.
* **Market value**: quantity-weighted mean of the cheapest 15% of units, similar to TSM's DBMarket.
* **You keep per unit** = list price − house cut − deposit × (1 / sell-through − 1).
  * House cut: 5% at faction houses, 15% at the neutral house.
  * Deposit: the Classic rule, % of vendor sell price by duration (2 h 5%, 8 h 20%, 24 h 60%), with a
    minimum per listing (1c since the 17/18 Nov maintenance, 1s before). The neutral house charges 5×.
  * Sell-through: the share of listings that sell before they expire. The defaults are 85% for
    commodities and 40% for gear, and you can change them. Each failed listing loses its deposit.
* **Reagent cost**: the cheapest of the AH, a vendor, crafting it yourself (up to 3 levels deep) or your
  bags. The AH price uses the real order book for big buys: the average to buy 10, 50 or 200 units. Your
  own materials are valued at what they would sell for (opportunity cost) unless you change it.
* **Best exit** for a crafted item: AH, neutral AH, disenchant (expected value of the mats after fees) or
  vendor, whichever leaves you the most.
* **Gold/day** = profit per craft × min(sales per day × your share, 50) ÷ items per craft. Your share
  defaults to 25%.
* **Skinning gold/hour** = skins per hour × the value of an average skin (main leather, lower-tier
  leather, hide, scarce materials boosted 20% per Bountiful Harvest rank). These are Classic-based
  baselines until your addon log has real numbers.

Where Forever differs from Classic and nobody has published the numbers yet (deposit formula, skinning
and disenchant tables, scarce material rates), Goldforge uses the Classic rule, says so in the app, and
lets the addon's measurements replace it.

## Repo layout

```
collector/   Python (standard library only): Battle.net client, snapshot stats, sales diff, game data
site/        the web app (plain HTML/CSS/JS, no build step); static/constants.json holds shared tables
addon/       the in-game Goldforge addon (Interface 16001)
seed/        fallback recipes, used only if wago.tools is unreachable (see NOTICE.md)
config.json  houses to track (111 primary, 117 neutral; 110/119/123 for the house check)
```

Run the collector tests with `cd collector && python -m pytest -q`. To try the site locally, run the
workflow once, download `data/` from the deployed site into `site/data/`, and serve `site/` with
`python -m http.server`.

GitHub turns off scheduled workflows in repos with no activity for 60 days. If prices stop updating,
open *Actions → Collect prices* and re-enable it.
