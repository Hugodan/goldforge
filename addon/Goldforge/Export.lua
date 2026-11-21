-- /gf export: a window with your data as one string to paste into the Goldforge web app.
local ADDON, ns = ...

local function buildExport()
  local DB = ns.DB
  if ns.ScanAll then pcall(ns.ScanAll) end
  local t = time()
  local prices = {}
  for id, p in pairs(DB.prices) do
    if p.t and t - p.t < 3 * 86400 then prices[tostring(id)] = p end
  end
  local chars = {}
  for key, c in pairs(DB.chars) do
    local recipes = {}
    for k, r in pairs(c.recipes or {}) do recipes[k] = r end
    local bags, bank = {}, {}
    for id, n in pairs(c.bags or {}) do bags[tostring(id)] = n end
    for id, n in pairs(c.bank or {}) do bank[tostring(id)] = n end
    chars[key] = { name = c.name, faction = c.faction, class = c.class, level = c.level, money = c.money,
                   profs = c.profs, recipes = recipes, bags = bags, bank = bank, updated = c.updated }
  end
  local vendor, skins, de = {}, {}, {}
  for id, v in pairs(DB.vendor) do vendor[tostring(id)] = v end
  for k, s in pairs(DB.skins) do
    local items = {}
    for id, c in pairs(s.items or {}) do items[tostring(id)] = c end
    skins[k] = { name = s.name, zone = s.zone, n = s.n, active = s.active, items = items }
  end
  for id, d in pairs(DB.de) do
    local out = {}
    for mid, c in pairs(d.out or {}) do out[tostring(mid)] = c end
    de[tostring(id)] = { n = d.n, out = out }
  end
  local recipeVendors, recipeDrops = {}, {}
  for id, v in pairs(DB.recipeVendors or {}) do recipeVendors[tostring(id)] = v end
  for id, v in pairs(DB.recipeDrops or {}) do recipeDrops[tostring(id)] = v end
  local posts = {}
  for i = math.max(1, #DB.posts - 99), #DB.posts do posts[#posts + 1] = DB.posts[i] end
  local data = { v = 1, t = t, addon = "1.1.0", chars = chars, ledger = DB.ledger, prices = prices,
                 vendor = vendor, skins = skins, de = de, posts = posts,
                 recipeVendors = recipeVendors, recipeDrops = recipeDrops }
  return "GF1:" .. ns.ToJSON(data)
end

local frame
local function showExport()
  if not ns.DB then return end
  local text = buildExport()
  if not frame then
    frame = CreateFrame("Frame", "GoldforgeExportFrame", UIParent, "BackdropTemplate")
    frame:SetSize(560, 380)
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("DIALOG")
    frame:SetMovable(true)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Gold-Border",
      tile = true, tileSize = 32, edgeSize = 32,
      insets = { left = 11, right = 12, top = 12, bottom = 11 },
    })
    local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    title:SetPoint("TOP", 0, -18)
    title:SetText("Goldforge export")
    local help = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    help:SetPoint("TOP", title, "BOTTOM", 0, -6)
    help:SetText("Press Ctrl+C, then paste into Goldforge > Settings > Goldforge addon.")
    frame.help = help
    local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -6, -6)
    local scroll = CreateFrame("ScrollFrame", "GoldforgeExportScroll", frame, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", 22, -62)
    scroll:SetPoint("BOTTOMRIGHT", -40, 22)
    local edit = CreateFrame("EditBox", nil, scroll)
    edit:SetMultiLine(true)
    edit:SetFontObject(ChatFontNormal)
    edit:SetWidth(480)
    edit:SetAutoFocus(true)
    edit:SetScript("OnEscapePressed", function() frame:Hide() end)
    edit:SetScript("OnTextChanged", function(self, user) if user then self:SetText(frame.text); self:HighlightText() end end)
    edit:SetScript("OnKeyUp", function(_, key)
      if key == "C" and IsControlKeyDown() then frame.help:SetText("|cff3ce35aCopied.|r Paste it into the Goldforge web app.") end
    end)
    scroll:SetScrollChild(edit)
    frame.edit = edit
    tinsert(UISpecialFrames, "GoldforgeExportFrame")
  end
  frame.text = text
  frame.edit:SetText(text)
  frame.edit:HighlightText()
  frame.help:SetText(("Press Ctrl+C, then paste into Goldforge > Settings (%d KB)."):format(math.ceil(#text / 1024)))
  frame:Show()
  frame.edit:SetFocus()
end

function Goldforge_OnAddonCompartmentClick() showExport() end

SLASH_GOLDFORGE1 = "/gf"
SLASH_GOLDFORGE2 = "/goldforge"
SlashCmdList.GOLDFORGE = function(msg)
  msg = (msg or ""):lower():gsub("^%s+", ""):gsub("%s+$", "")
  local DB = ns.DB
  if msg == "" or msg == "export" then
    showExport()
  elseif msg == "status" then
    local nchars, nrec, nled, nskin, nde = 0, 0, #DB.ledger, 0, 0
    for _, c in pairs(DB.chars) do nchars = nchars + 1; for _ in pairs(c.recipes or {}) do nrec = nrec + 1 end end
    for _ in pairs(DB.skins) do nskin = nskin + 1 end
    for _ in pairs(DB.de) do nde = nde + 1 end
    ns.say(("%d characters, %d known recipes, %d ledger entries, %d skinned mob types, %d disenchanted item types."):format(nchars, nrec, nled, nskin, nde))
  elseif msg == "debug" then
    ns.debug = not ns.debug
    ns.say("debug " .. (ns.debug and "on" or "off"))
  elseif msg == "reset yes" then
    GoldforgeDB = nil
    ReloadUI()
  elseif msg == "reset" then
    ns.say("this deletes everything Goldforge has recorded. Type |cffffffff/gf reset yes|r to confirm.")
  else
    ns.say("/gf export · /gf status · /gf reset")
  end
end
