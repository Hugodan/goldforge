-- Goldforge: records what the web app cannot see from Blizzard's API.
--   * known recipes with reagents (every profession window you open)
--   * bags and bank contents, gold, profession skill
--   * auction sales, purchases, expired/cancelled auctions (mailbox and AH events)
--   * prices you see at the auction house (to confirm which house is yours)
--   * vendor prices of trade goods
--   * what each skinned mob and each disenchanted item actually gave you
-- Nothing is sent anywhere: /gf export shows a string you paste into the web app.
local ADDON, ns = ...

local DB, charKey, charDB
local LEDGER_DAYS = 60
local f = CreateFrame("Frame")

local function now() return time() end
local function say(msg) print("|cffffd100Goldforge|r: " .. msg) end
ns.say = say

local function safe(fn, ...)
  local ok, a, b, c, d = pcall(fn, ...)
  if ok then return a, b, c, d end
end

local function itemIDFromLink(link)
  if not link then return nil end
  local id = link:match("item:(%d+)")
  return id and tonumber(id)
end

local function itemIDFromName(name)
  if not name or name == "" then return nil end
  if C_Item and C_Item.GetItemInfoInstant then
    local id = safe(C_Item.GetItemInfoInstant, name)
    if type(id) == "number" then return id end
  end
  if GetItemInfoInstant then
    local id = safe(GetItemInfoInstant, name)
    if type(id) == "number" then return id end
  end
  return nil
end

local function spellName(id)
  if C_Spell and C_Spell.GetSpellName then return safe(C_Spell.GetSpellName, id) end
  if GetSpellInfo then return (safe(GetSpellInfo, id)) end
end

-- ------------------------------------------------------------------------- database
local function initDB()
  GoldforgeDB = GoldforgeDB or {}
  DB = GoldforgeDB
  DB.v = 1
  DB.chars = DB.chars or {}
  DB.ledger = DB.ledger or {}
  DB.seen = DB.seen or {}
  DB.prices = DB.prices or {}
  DB.vendor = DB.vendor or {}
  DB.skins = DB.skins or {}
  DB.de = DB.de or {}
  DB.posts = DB.posts or {}
  ns.DB = DB
end

local function initChar()
  local name = UnitName("player") or "?"
  charKey = name .. "-" .. (UnitFactionGroup("player") or "?")
  DB.chars[charKey] = DB.chars[charKey] or { recipes = {}, bags = {}, bank = {}, profs = {} }
  charDB = DB.chars[charKey]
  charDB.name = name
  charDB.faction = UnitFactionGroup("player")
  charDB.class = select(2, UnitClass("player"))
  ns.charKey, ns.charDB = charKey, charDB
end

local function ledgerAdd(e)
  e.t = e.t or now()
  e.char = charDB.name
  e.id = e.id or table.concat({ e.type, e.t, e.item or e.name or "", e.qty or 1, e.gold or 0 }, ":")
  table.insert(DB.ledger, e)
  -- trim old entries
  local cutoff = now() - LEDGER_DAYS * 86400
  while DB.ledger[1] and DB.ledger[1].t < cutoff do table.remove(DB.ledger, 1) end
end

-- ------------------------------------------------------------------------- character
local function scanProfessions()
  charDB.level = UnitLevel("player")
  charDB.money = GetMoney()
  local profs = {}
  if GetProfessions and GetProfessionInfo then
    local list = { GetProfessions() }
    for i = 1, 5 do
      local idx = list[i]
      if idx then
        local name, _, rank, maxRank = GetProfessionInfo(idx)
        if name then profs[name] = { rank = rank, max = maxRank } end
      end
    end
  end
  if not next(profs) and GetNumSkillLines then
    for i = 1, GetNumSkillLines() do
      local name, isHeader, _, rank, _, _, maxRank = GetSkillLineInfo(i)
      if name and not isHeader and maxRank and maxRank > 1 and rank then profs[name] = { rank = rank, max = maxRank } end
    end
  end
  if next(profs) then charDB.profs = profs end
end

local function containerSlots(bag)
  if C_Container and C_Container.GetContainerNumSlots then return C_Container.GetContainerNumSlots(bag) or 0 end
  return GetContainerNumSlots and GetContainerNumSlots(bag) or 0
end

local function containerItem(bag, slot)
  if C_Container and C_Container.GetContainerItemInfo then
    local info = C_Container.GetContainerItemInfo(bag, slot)
    if info then return info.itemID, info.stackCount end
    return nil
  end
  if GetContainerItemInfo then
    local _, count, _, _, _, _, link = GetContainerItemInfo(bag, slot)
    return itemIDFromLink(link), count
  end
end

local function scanBags(bags)
  local out = {}
  for _, bag in ipairs(bags) do
    for slot = 1, containerSlots(bag) do
      local id, count = containerItem(bag, slot)
      if id then out[id] = (out[id] or 0) + (count or 1) end
    end
  end
  return out
end

local function playerBags()
  local t = {}
  local last = NUM_TOTAL_EQUIPPED_BAG_SLOTS or NUM_BAG_SLOTS or 4
  for i = 0, last do t[#t + 1] = i end
  return t
end

local function bankBags()
  local t = { BANK_CONTAINER or -1 }
  local first = (NUM_TOTAL_EQUIPPED_BAG_SLOTS or NUM_BAG_SLOTS or 4) + 1
  for i = first, first + (NUM_BANKBAGSLOTS or 7) - 1 do t[#t + 1] = i end
  if REAGENTBANK_CONTAINER then t[#t + 1] = REAGENTBANK_CONTAINER end
  return t
end

local bagTimer
local function updateBags()
  if bagTimer then return end
  bagTimer = true
  C_Timer.After(1, function()
    bagTimer = nil
    charDB.bags = scanBags(playerBags())
    charDB.money = GetMoney()
    charDB.updated = now()
  end)
end

-- ------------------------------------------------------------------------- recipes
local function readRecipesModern()
  if not (C_TradeSkillUI and C_TradeSkillUI.GetAllRecipeIDs) then return false end
  local ids = safe(C_TradeSkillUI.GetAllRecipeIDs)
  if not ids or #ids == 0 then return false end
  local prof = "?"
  local base = C_TradeSkillUI.GetBaseProfessionInfo and safe(C_TradeSkillUI.GetBaseProfessionInfo)
  if base and base.professionName then
    prof = base.professionName
    if base.skillLevel then charDB.profs[prof] = { rank = base.skillLevel, max = base.maxSkillLevel } end
  end
  local n = 0
  for _, id in ipairs(ids) do
    local info = safe(C_TradeSkillUI.GetRecipeInfo, id)
    if info and info.learned then
      local rec = { n = info.name, prof = prof }
      local sch = C_TradeSkillUI.GetRecipeSchematic and safe(C_TradeSkillUI.GetRecipeSchematic, id, false)
      if sch then
        rec.i = sch.outputItemID
        rec.m = sch.quantityMin or 1
        rec.r = {}
        for _, slot in ipairs(sch.reagentSlotSchematics or {}) do
          local reagent = slot.reagents and slot.reagents[1]
          if reagent and reagent.itemID then rec.r[#rec.r + 1] = { reagent.itemID, slot.quantityRequired or 1 } end
        end
      end
      charDB.recipes["s" .. id] = rec
      n = n + 1
    end
  end
  return n > 0, n, prof
end

local function readRecipesClassic()
  if not GetNumTradeSkills then return false end
  local profName = GetTradeSkillLine and GetTradeSkillLine()
  local n = 0
  for i = 1, GetNumTradeSkills() do
    local name, kind = GetTradeSkillInfo(i)
    if name and kind ~= "header" and kind ~= "subheader" then
      local rec = { n = name, prof = profName, r = {} }
      rec.i = itemIDFromLink(GetTradeSkillItemLink(i))
      rec.m = (GetTradeSkillNumMade and GetTradeSkillNumMade(i)) or 1
      for j = 1, (GetTradeSkillNumReagents and GetTradeSkillNumReagents(i) or 0) do
        local _, _, count = GetTradeSkillReagentInfo(i, j)
        local rid = itemIDFromLink(GetTradeSkillReagentItemLink(i, j))
        if rid then rec.r[#rec.r + 1] = { rid, count or 1 } end
      end
      local recipeLink = GetTradeSkillRecipeLink and GetTradeSkillRecipeLink(i)
      local spell = recipeLink and tonumber(recipeLink:match("enchant:(%d+)") or "")
      charDB.recipes[spell and ("s" .. spell) or ("n" .. name)] = rec
      n = n + 1
    end
  end
  return n > 0, n, profName
end

local recipeTimer
local function readRecipes()
  if recipeTimer then return end
  recipeTimer = true
  C_Timer.After(0.5, function()
    recipeTimer = nil
    local ok, n, prof = readRecipesModern()
    if not ok then ok, n, prof = readRecipesClassic() end
    if ok and n and n > 0 then
      charDB.recipesUpdated = now()
      if not ns.recipeAnnounced or ns.recipeAnnounced ~= prof then
        ns.recipeAnnounced = prof
        say(("saved %d known %s recipes."):format(n, prof or "profession"))
      end
    end
  end)
end

-- ------------------------------------------------------------------------- mail: sales, expired, cancelled
local function subjectPattern(fmt)
  if not fmt then return nil end
  local escaped = fmt:gsub("([%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
  local pattern = escaped:gsub("%%s", "(.+)")
  return "^" .. pattern .. "$"
end

local EXPIRED = subjectPattern(AUCTION_EXPIRED_MAIL_SUBJECT)
local CANCELLED = subjectPattern(AUCTION_REMOVED_MAIL_SUBJECT)

local function lastPostDeposit(itemID)
  for i = #DB.posts, 1, -1 do
    local p = DB.posts[i]
    if p.item == itemID and p.deposit then return p.deposit end
  end
end

local function scanMail()
  local n = GetInboxNumItems and GetInboxNumItems() or 0
  for i = 1, n do
    local _, _, sender, subject, money, _, daysLeft, itemCount = GetInboxHeaderInfo(i)
    if subject and daysLeft then
      local received = now() - math.floor((30 - daysLeft) * 86400)
      local hour = math.floor(received / 3600)
      local base = table.concat({ sender or "", subject, money or 0, itemCount or 0 }, "|")
      local seen = DB.seen[base .. "|" .. hour] or DB.seen[base .. "|" .. (hour - 1)] or DB.seen[base .. "|" .. (hour + 1)]
      if not seen then
        local invoiceType, itemName, _, bid, _, deposit, consignment, _, _, count = GetInboxInvoiceInfo(i)
        local recorded = false
        if invoiceType == "seller" and bid then
          ledgerAdd({ t = received, type = "sale", name = itemName, item = itemIDFromName(itemName), qty = count or 1,
                      gold = bid - (consignment or 0), gross = bid, cut = consignment, deposit = deposit })
          recorded = true
        elseif invoiceType == "buyer" and bid then
          ledgerAdd({ t = received, type = "buy", name = itemName, item = itemIDFromName(itemName), qty = count or 1, gold = bid })
          recorded = true
        else
          local expiredItem = EXPIRED and subject:match(EXPIRED)
          local cancelledItem = CANCELLED and subject:match(CANCELLED)
          local nm = expiredItem or cancelledItem
          if nm then
            local id = itemIDFromName(nm)
            ledgerAdd({ t = received, type = expiredItem and "expired" or "cancelled", name = nm, item = id,
                        qty = itemCount or 1, gold = 0, deposit = id and lastPostDeposit(id) or nil })
            recorded = true
          end
        end
        if recorded then DB.seen[base .. "|" .. hour] = received end
      end
    end
  end
  -- forget dedupe keys older than the mail itself can be
  local cutoff = now() - 32 * 86400
  for k, t in pairs(DB.seen) do if t < cutoff then DB.seen[k] = nil end end
end

-- ------------------------------------------------------------------------- auction house
local pendingCommodity, pendingPost
local itemAuctions = {}
local pendingBids = {}

local function observe(itemID, unit, qty)
  if not itemID or not unit or unit <= 0 then return end
  DB.prices[itemID] = { p = unit, q = qty, t = now() }
end

local function onCommodityResults(itemID)
  local r = C_AuctionHouse.GetCommoditySearchResultInfo and safe(C_AuctionHouse.GetCommoditySearchResultInfo, itemID, 1)
  if r and r.unitPrice then observe(itemID, r.unitPrice, r.quantity) end
end

local function onItemResults(itemKey)
  if not itemKey then return end
  local num = safe(C_AuctionHouse.GetNumItemSearchResults, itemKey) or 0
  local best
  for i = 1, num do
    local r = safe(C_AuctionHouse.GetItemSearchResultInfo, itemKey, i)
    if r and r.auctionID then
      itemAuctions[r.auctionID] = { item = itemKey.itemID, buyout = r.buyoutAmount }
      if r.buyoutAmount and (not best or r.buyoutAmount < best) then best = r.buyoutAmount end
    end
  end
  if best then observe(itemKey.itemID, best, num) end
end

local function hookAuctionHouse()
  if not C_AuctionHouse or ns.ahHooked then return end
  ns.ahHooked = true
  if C_AuctionHouse.StartCommoditiesPurchase then
    hooksecurefunc(C_AuctionHouse, "StartCommoditiesPurchase", function(itemID, quantity)
      pendingCommodity = { item = itemID, qty = quantity }
    end)
  end
  if C_AuctionHouse.ConfirmCommoditiesPurchase then
    hooksecurefunc(C_AuctionHouse, "ConfirmCommoditiesPurchase", function(itemID, quantity)
      pendingCommodity = pendingCommodity or {}
      pendingCommodity.item, pendingCommodity.qty, pendingCommodity.confirmed = itemID, quantity, true
    end)
  end
  if C_AuctionHouse.PlaceBid then
    hooksecurefunc(C_AuctionHouse, "PlaceBid", function(auctionID, bidAmount)
      local a = itemAuctions[auctionID]
      pendingBids[auctionID] = { item = a and a.item, gold = bidAmount, buyout = a and a.buyout and bidAmount >= a.buyout }
    end)
  end
  local function hookPost(fname, priceOf)
    if not C_AuctionHouse[fname] then return end
    hooksecurefunc(C_AuctionHouse, fname, function(itemLocation, duration, quantity, ...)
      local id = itemLocation and C_Item and C_Item.GetItemID and safe(C_Item.GetItemID, itemLocation)
      pendingPost = { item = id, qty = quantity or 1, price = priceOf(...), duration = duration, money = GetMoney(), t = GetTime() }
    end)
  end
  hookPost("PostCommodity", function(unitPrice) return unitPrice end)
  hookPost("PostItem", function(_, buyout) return buyout end)
end

-- ------------------------------------------------------------------------- skinning & disenchanting
local SKINNING = spellName(8613) or "Skinning"
local DISENCHANT = spellName(13262) or "Disenchant"
local pendingLoot
local lastSkin = 0

local function onSpellSent(unit, target, _, spellID)
  if unit ~= "player" then return end
  local name = spellName(spellID)
  if name == SKINNING then
    pendingLoot = { kind = "skin", target = target, t = GetTime() }
  elseif name == DISENCHANT or spellID == 13262 then
    pendingLoot = { kind = "de", target = target, t = GetTime() }
  end
end

local function npcFromGUID(guid)
  if not guid then return nil end
  local kind, _, _, _, _, npc = strsplit("-", guid)
  if kind == "Creature" then return tonumber(npc) end
end

local function onLoot()
  if not pendingLoot or GetTime() - pendingLoot.t > 6 then return end
  local p = pendingLoot
  pendingLoot = nil
  local items, sourceGUID = {}, nil
  for slot = 1, (GetNumLootItems and GetNumLootItems() or 0) do
    local id = itemIDFromLink(GetLootSlotLink(slot))
    local _, _, qty = GetLootSlotInfo(slot)
    if id then items[id] = (items[id] or 0) + (qty or 1) end
    if not sourceGUID and GetLootSourceInfo then sourceGUID = GetLootSourceInfo(slot) end
  end
  if not next(items) then return end
  if p.kind == "skin" then
    local npc = npcFromGUID(sourceGUID) or p.target or "unknown"
    local key = tostring(npc)
    local s = DB.skins[key] or { n = 0, items = {}, active = 0 }
    s.name = p.target or s.name
    s.zone = GetZoneText and GetZoneText() or s.zone
    s.n = s.n + 1
    for id, c in pairs(items) do s.items[id] = (s.items[id] or 0) + c end
    local t = now()
    if lastSkin > 0 and t - lastSkin < 300 then s.active = s.active + (t - lastSkin) end
    lastSkin = t
    s.last = t
    DB.skins[key] = s
  else
    local itemID
    if sourceGUID and C_Item and C_Item.GetItemIDByGUID then itemID = safe(C_Item.GetItemIDByGUID, sourceGUID) end
    itemID = itemID or itemIDFromName(p.target)
    if itemID then
      local d = DB.de[itemID] or { n = 0, out = {} }
      d.n = d.n + 1
      for id, c in pairs(items) do d.out[id] = (d.out[id] or 0) + c end
      DB.de[itemID] = d
    end
  end
end

-- ------------------------------------------------------------------------- vendors
local function scanMerchant()
  local n = GetMerchantNumItems and GetMerchantNumItems() or 0
  for i = 1, n do
    local link = GetMerchantItemLink(i)
    local id = itemIDFromLink(link)
    local price, stack, extended
    if C_MerchantFrame and C_MerchantFrame.GetItemInfo then
      local info = safe(C_MerchantFrame.GetItemInfo, i)
      if info then price, stack, extended = info.price, info.stackCount, info.hasExtendedCost end
    end
    if not price and GetMerchantItemInfo then
      local _, _, p, q, _, _, _, ext = GetMerchantItemInfo(i)
      price, stack, extended = p, q, ext
    end
    if id and price and price > 0 and not extended then DB.vendor[id] = math.floor(price / math.max(1, stack or 1) + 0.5) end
  end
end

-- ------------------------------------------------------------------------- events
local handlers = {
  ADDON_LOADED = function(name)
    if name ~= ADDON then return end
    initDB()
  end,
  PLAYER_LOGIN = function()
    if not DB then initDB() end
    initChar()
    scanProfessions()
    updateBags()
    hookAuctionHouse()
    say("ready. Type |cffffffff/gf export|r to copy your data into the Goldforge web app.")
  end,
  BAG_UPDATE_DELAYED = updateBags,
  PLAYER_MONEY = function()
    charDB.money = GetMoney()
    if pendingPost and GetTime() - pendingPost.t < 4 then
      local paid = pendingPost.money - GetMoney()
      if paid > 0 then
        pendingPost.deposit = paid / math.max(1, pendingPost.qty)
        DB.posts[#DB.posts + 1] = { item = pendingPost.item, qty = pendingPost.qty, price = pendingPost.price,
                                    deposit = pendingPost.deposit, duration = pendingPost.duration, t = now() }
        while #DB.posts > 300 do table.remove(DB.posts, 1) end
      end
      pendingPost = nil
    end
  end,
  SKILL_LINES_CHANGED = scanProfessions,
  TRADE_SKILL_SHOW = readRecipes,
  TRADE_SKILL_LIST_UPDATE = readRecipes,
  TRADE_SKILL_UPDATE = readRecipes,
  BANKFRAME_OPENED = function()
    C_Timer.After(1, function() charDB.bank = scanBags(bankBags()); charDB.bankUpdated = now() end)
  end,
  PLAYERBANKSLOTS_CHANGED = function()
    C_Timer.After(0.5, function() charDB.bank = scanBags(bankBags()) end)
  end,
  MAIL_INBOX_UPDATE = function() safe(scanMail) end,
  MERCHANT_SHOW = function() C_Timer.After(0.3, function() safe(scanMerchant) end) end,
  AUCTION_HOUSE_SHOW = hookAuctionHouse,
  COMMODITY_SEARCH_RESULTS_UPDATED = function(itemID) safe(onCommodityResults, itemID) end,
  ITEM_SEARCH_RESULTS_UPDATED = function(itemKey) safe(onItemResults, itemKey) end,
  COMMODITY_PRICE_UPDATED = function(unitPrice, totalPrice)
    if pendingCommodity then pendingCommodity.total, pendingCommodity.unit = totalPrice, unitPrice end
  end,
  COMMODITY_PURCHASE_SUCCEEDED = function()
    local p = pendingCommodity
    pendingCommodity = nil
    if p and p.item then
      local gold = p.total or (p.unit and p.unit * (p.qty or 1))
      if gold then ledgerAdd({ type = "buy", item = p.item, qty = p.qty or 1, gold = gold }) end
    end
  end,
  AUCTION_HOUSE_PURCHASE_COMPLETED = function(auctionID)
    local b = pendingBids[auctionID]
    pendingBids[auctionID] = nil
    if b and b.gold then ledgerAdd({ type = "buy", item = b.item, qty = 1, gold = b.gold }) end
  end,
  UNIT_SPELLCAST_SENT = onSpellSent,
  LOOT_READY = function() safe(onLoot) end,
  LOOT_OPENED = function() safe(onLoot) end,
}

for event in pairs(handlers) do
  pcall(f.RegisterEvent, f, event)   -- some events may not exist in every client build
end
f:SetScript("OnEvent", function(_, event, ...)
  local h = handlers[event]
  if h and (charDB or event == "ADDON_LOADED" or event == "PLAYER_LOGIN") then
    local ok, err = pcall(h, ...)
    if not ok and ns.debug then say("error in " .. event .. ": " .. tostring(err)) end
  end
end)

ns.ScanAll = function()
  scanProfessions()
  charDB.bags = scanBags(playerBags())
  charDB.money = GetMoney()
  charDB.updated = now()
end
