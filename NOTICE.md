# Third-party data

## seed/recipes.json and seed/items.json

Converted from the profession JSON files (alchemy, blacksmithing, enchanting, engineering, first aid,
leatherworking, tailoring) and `food/foods.json` in [jykwon91/MyFreeApps](https://github.com/jykwon91/MyFreeApps)
(itself generated from wago.tools DB2 extracts of WoW Forever build 1.60.1.70888). Goldforge only uses it
as a fallback when wago.tools cannot be reached, and to fill in where a pattern is learned.

```
MIT License

Copyright (c) 2026 Jason Kwon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## site/static/sources.json

Where each recipe item is sold, dropped, found or rewarded. Built by `tools/build_sources.py` from
[QuestieDB](https://github.com/questie/QuestieDB) `data/Forever/*` (item, NPC, object and quest data,
zone names from `src/corrections/enum/zones.lua`). QuestieDB is licensed under GPL-3.0, so this derived
data file is distributed under the GNU General Public License v3.0: see `site/static/sources.LICENSE.md`.
The parser reads QuestieDB's files as text and never executes them.

## Game data and prices

Auction data comes from the Blizzard Battle.net Game Data API under Blizzard's developer terms. Item and
recipe data comes from wago.tools extracts of the WoW Forever client. Item icons are loaded from
Blizzard's render CDN as returned by the Battle.net media API. World of Warcraft and WoW Forever are
trademarks of Blizzard Entertainment, Inc. Goldforge is not affiliated with Blizzard.
