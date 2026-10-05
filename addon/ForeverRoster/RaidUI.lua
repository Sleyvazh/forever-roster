-- Fenêtres du raid (lot G) : butin du maître du butin, conseil du butin (réponse et votes), fiche du boss avant le pull,
-- et l'onglet « En raid » de la fenêtre principale. Les données et les messages sont dans Raid.lua.
local _, ns = ...
local RA = ns.Raid
local U = ns.UI
local K = U.kit

local GOLD, GREY, GREEN, RED, ORANGE, BLUE = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f", "|cffff6b5e", "|cfff0b43c", "|cff6fb7ff"
local function linkFor(id, link) return link or ns.Group.linkFor(id) end
local function names(list, max)
  if #list == 0 then return nil end
  local shown = {}
  for i = 1, math.min(#list, max or 8) do shown[i] = list[i] end
  return table.concat(shown, ", ") .. (#list > #shown and (" +" .. (#list - #shown)) or "")
end
local function remaining(at)
  local left = math.max(0, 2 * 3600 - (time() - at))
  return left >= 3600 and string.format("%d h %02d", math.floor(left / 3600), math.floor(left % 3600 / 60)) or string.format("%d min", math.floor(left / 60)), left
end

-- Page à liste dans une fenêtre (même mise en page que les onglets de la fenêtre principale)
local function listWindow(name, title, h)
  local w = K.window(name, title, 600, h)
  local p = CreateFrame("Frame", nil, w)
  p:SetPoint("TOPLEFT", 14, K.site() and -36 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
  w.hintText = K.hint(p, "")
  w.list = K.list(p, -40)
  return w
end

--------------------------------------------------------------------------------------------------------------------
-- Butin (maître du butin)
--------------------------------------------------------------------------------------------------------------------
local lootWin
local KIND = { sr = "soft reserve", ms = "spé principale (MS)", os = "spé secondaire (OS)", free = "jet libre" }
function RA.ShowLoot()
  if not lootWin then lootWin = listWindow("ForeverRosterMasterLoot", "Butin · maître du butin", 470) end
  K.front(lootWin)
  lootWin:Show()
  RA.RefreshLoot()
end
function RA.RefreshLoot()
  if not lootWin or not lootWin:IsShown() then return end
  local L, d, s = lootWin.list, RA.Current(), RA.session
  local mode = d and d.loot or "journal"
  lootWin.hintText:SetText(d and (GOLD .. d.entry.raid.name .. "|r · butin : " .. (mode == "softres" and "soft reserve" or mode == "council" and "conseil du butin" or "journal"))
    or (GREY .. "Pas de raid du site en cours : jets libres ou MS / OS seulement.|r"))
  L.Reset()
  L.Header("Objets")
  if #RA.items == 0 then L.Add(GREY .. "Aucun objet. Ouvre un corps en maître du butin, ou /fr butin puis Maj+clic sur un objet.|r") end
  for _, it in ipairs(RA.items) do
    local res, list = RA.ReservesOf(it.itemId)
    local text = linkFor(it.itemId, it.link) .. (it.slot and "" or (GREY .. "  (dans les sacs)|r"))
    local buttons = {}
    if mode == "softres" and res then
      local who = {}
      for _, x in ipairs(list) do who[#who + 1] = x.name .. ((x.bonus or 0) > 0 and (GREY .. " +" .. x.bonus .. "|r") or "") end
      text = text .. "\n" .. GREEN .. "SR : |r" .. table.concat(who, ", ")
      buttons[#buttons + 1] = { "Jets SR", 110, function() RA.StartRoll(it, "sr") end }
    else
      if mode == "softres" then text = text .. "\n" .. GREY .. "Personne ne l'a réservé.|r" end
      if mode == "council" then buttons[#buttons + 1] = { "Conseil", 100, function() RA.StartCouncil(it) end } end
      buttons[#buttons + 1] = { "Jets MS / OS", 130, function() RA.StartRoll(it, "ms") end }
      buttons[#buttons + 1] = { "Jet libre", 100, function() RA.StartRoll(it, "free") end }
    end
    L.Add(text, buttons)
  end
  if s and s.kind == "council" then
    L.Header("Conseil en cours")
    L.Add(linkFor(s.item.itemId, s.item.link), { { "Fenêtre du conseil", 170, function() RA.ShowCouncil(s.sid) end }, { "Annuler", 90, function() RA.session = nil RA.RefreshWindows() end } })
  elseif s then
    L.Header("Jets · " .. (KIND[s.kind] or s.kind))
    local list, tied = RA.Ranking(s)
    L.Add(linkFor(s.item.itemId, s.item.link) .. GREY .. "  /roll " .. s.max .. (s.kind == "sr" and ", bonus SR+ ajouté" or "") .. "|r")
    if #list == 0 then L.Add(GREY .. "En attente des jets…|r") end
    for i, x in ipairs(list) do
      L.Add((i == 1 and not tied and (GOLD .. "★ ") or "") .. x.name .. "|r  " .. x.roll .. (s.kind == "sr" and (GREY .. " +" .. x.bonus .. " = |r" .. x.total) or ""))
    end
    for n, r in pairs(s.ignored) do L.Add(GREY .. n .. "  " .. r .. " — pas de réservation, ignoré|r") end
    local buttons = {}
    if #list > 0 and not tied then
      local w = list[1].name
      buttons[#buttons + 1] = { "Donner à " .. w, 180, function() RA.AwardSession() end }
      buttons[#buttons + 1] = { "Garder, à remettre", 160, function()
        RA.Keep(s.item, w, s.kind == "sr" and "sr" or "roll", nil, RA.RollDetail(s, list[1]))
      end }
    end
    if tied then buttons[#buttons + 1] = { "Relancer : " .. table.concat(tied, ", "), 260, function() RA.StartRoll(s.item, s.kind, tied) end } end
    if s.kind == "ms" and #list == 0 then buttons[#buttons + 1] = { "Passer aux jets OS", 160, function() RA.StartRoll(s.item, "os") end } end
    buttons[#buttons + 1] = { "Annuler", 90, function() RA.session = nil RA.RefreshWindows() end }
    L.Add(GREY .. "Égalité : seuls les ex æquo relancent. Corps fermé : l'objet part dans les objets à remettre.|r", buttons)
  end
  L.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Conseil du butin : réponse du joueur, puis fenêtre du conseil (votes)
--------------------------------------------------------------------------------------------------------------------
local ask
function RA.ShowAsk()
  local a = RA.asks[1]
  if not a then if ask then ask:Hide() end return end
  if not ask then
    ask = K.window("ForeverRosterAsk", "Conseil du butin · ta réponse", 470, 210)
    ask:ClearAllPoints() ask:SetPoint("TOP", 0, -140)
    local x = K.site() and 18 or 66
    ask.text = ask:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    ask.text:SetPoint("TOPLEFT", x, -36) ask.text:SetWidth(470 - x - 18) ask.text:SetJustifyH("LEFT")
    ask.note = CreateFrame("EditBox", nil, ask, "InputBoxTemplate")
    ask.note:SetSize(470 - x - 26, 22) ask.note:SetPoint("TOPLEFT", x + 4, -104) ask.note:SetAutoFocus(false) ask.note:SetMaxLetters(80)
    ask.buttons = {}
    local order = { "bis", "upgrade", "off", "transmo", "pass" }
    for i, key in ipairs(order) do
      local b = K.button(ask, RA.RESPONSES[key], 70, nil)
      b:SetPoint("TOPLEFT", x + (i - 1) * 74, -136)
      b:SetScript("OnClick", function() local cur = RA.asks[1] if cur then RA.Respond(cur, key, ask.note:GetText()) ask.note:SetText("") RA.ShowAsk() end end)
      ask.buttons[i] = b
    end
    ask.timer = ask:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    ask.timer:SetPoint("TOPLEFT", x, -168) ask.timer:SetWidth(470 - x - 18) ask.timer:SetJustifyH("LEFT")
  end
  local gear = {}
  for _, id in ipairs(RA.Equipped(a.itemId)) do gear[#gear + 1] = linkFor(id) end
  ask.text:SetText(linkFor(a.itemId) .. GREY .. "  proposé par " .. a.ml .. "|r\n" .. (#gear > 0 and ("Tu portes : " .. table.concat(gear, ", ")) or GREY .. "Rien de porté à cet emplacement.|r")
    .. (#RA.asks > 1 and (GREY .. "\n" .. (#RA.asks - 1) .. " autre(s) objet(s) ensuite.|r") or ""))
  ask.timer:SetText(GREY .. "Une précision au besoin, puis ta réponse. Sans addon, on peut chuchoter bis, up, os au maître du butin.|r")
  K.front(ask)
  ask:Show()
end

local councilWin
function RA.ShowCouncil(sid)
  if not councilWin then councilWin = listWindow("ForeverRosterCouncil", "Conseil du butin", 470) end
  councilWin.sid = sid
  K.front(councilWin)
  councilWin:Show()
  RA.RefreshCouncil()
end
function RA.RefreshCouncil()
  if not councilWin or not councilWin:IsShown() then return end
  local c, L = RA.councils[councilWin.sid], councilWin.list
  L.Reset()
  if not c then
    councilWin.hintText:SetText(GREY .. "Ce conseil est terminé.|r")
    L.Done()
    return
  end
  local isML = c.ml == UnitName("player")
  local votes, by = RA.Tally(councilWin.sid)
  councilWin.hintText:SetText(linkFor(c.itemId, c.link) .. GREY .. "  · maître du butin : " .. c.ml .. (isML and " (toi)" or "") .. "|r")
  local log, got = ns.Recorder.Current(), {}
  for _, l in ipairs(log and log.loot or {}) do got[l.who] = (got[l.who] or 0) + 1 end
  local order = { bis = 1, upgrade = 2, off = 3, transmo = 4, pass = 5 }
  local list = {}
  for n, x in pairs(c.cands) do list[#list + 1] = { name = n, x = x } end
  table.sort(list, function(a, b) local oa, ob = order[a.x.response] or 9, order[b.x.response] or 9 if oa ~= ob then return oa < ob end return (votes[a.name] or 0) > (votes[b.name] or 0) end)
  L.Header("Réponses · " .. #list)
  if #list == 0 then L.Add(GREY .. "En attente des réponses…|r") end
  for _, e in ipairs(list) do
    local gear = {}
    for _, id in ipairs(e.x.gear) do gear[#gear + 1] = linkFor(id) end
    local mine = c.votes[UnitName("player")] == e.name
    local text = GOLD .. e.name .. "|r  " .. (e.x.response == "bis" and GREEN or e.x.response == "upgrade" and BLUE or GREY) .. (RA.RESPONSES[e.x.response] or e.x.response) .. "|r"
      .. GREY .. "  · ce soir : " .. (got[e.name] or 0) .. " objet(s)  · " .. (votes[e.name] or 0) .. " voix|r"
      .. (#gear > 0 and ("\n" .. GREY .. "porte |r" .. table.concat(gear, ", ")) or "") .. (e.x.note ~= "" and ("\n" .. GREY .. "« " .. e.x.note .. " »|r") or "")
    local buttons = {}
    if e.x.response ~= "pass" then buttons[#buttons + 1] = { mine and "Voté" or "Voter", 90, function() RA.Vote(councilWin.sid, e.name) end } end
    if isML and e.x.response ~= "pass" then buttons[#buttons + 1] = { "Donner à " .. e.name, 170, function() RA.AwardCouncil(councilWin.sid, e.name) end } end
    L.Add(text, buttons)
  end
  local waiting = {}
  for _, n in ipairs(RA.Members()) do if not c.cands[n] then waiting[#waiting + 1] = n end end
  if #waiting > 0 then L.Add(GREY .. "Pas encore répondu : " .. names(waiting, 12) .. "|r") end
  if #by > 0 then L.Add(GREY .. "Voix : " .. table.concat(by, " · ") .. "|r") end
  L.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Fiche du boss (en ciblant le boss, avant le pull)
--------------------------------------------------------------------------------------------------------------------
local sheetWin
function RA.ShowSheet(sheet)
  if not sheetWin then
    sheetWin = K.window("ForeverRosterBoss", "Boss", 460, 220)
    sheetWin:ClearAllPoints() sheetWin:SetPoint("TOP", 0, -110)
    local x = K.site() and 18 or 66
    sheetWin.mine = sheetWin:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    sheetWin.mine:SetPoint("TOPLEFT", x, -36) sheetWin.mine:SetWidth(460 - x - 18) sheetWin.mine:SetJustifyH("LEFT")
    sheetWin.text = sheetWin:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    sheetWin.text:SetPoint("TOPLEFT", x, -64) sheetWin.text:SetWidth(460 - x - 18) sheetWin.text:SetJustifyH("LEFT")
    sheetWin.announce = K.button(sheetWin, "Annoncer en /raid", 160, nil)
    sheetWin.announce:SetPoint("BOTTOMLEFT", x, 12)
    local close = K.button(sheetWin, "Fermer", 100, function() if sheetWin.sheet then RA.dismissed[sheetWin.sheet.name] = time() end sheetWin:Hide() end)
    close:SetPoint("BOTTOMRIGHT", -16, 12)
  end
  sheetWin.sheet = sheet
  sheetWin:SetWindowTitle(sheet.name .. " · ta tâche")
  local mine = RA.MyTasks(sheet)
  sheetWin.mine:SetText(#mine > 0 and ("|cffffffff" .. table.concat(mine, " · ") .. "|r") or (GREY .. "Pas de tâche pour toi|r"))
  local lines = {}
  for _, l in ipairs(RA.SheetLines(sheet)) do lines[#lines + 1] = (l.label ~= "" and (GREY .. l.label .. " : |r") or "") .. l.value end
  sheetWin.text:SetText(table.concat(lines, "\n") .. "\n" .. GREY .. "Se ferme au début du combat · /fr boss pour la revoir|r")
  local h = 110 + ((sheetWin.text.GetStringHeight and sheetWin.text:GetStringHeight()) or 60)
  sheetWin:SetHeight(math.max(170, math.min(420, h)))
  sheetWin.announce:SetScript("OnClick", function() RA.AnnounceSheet(sheet) end)
  if RA.isLeader() then sheetWin.announce:Show() else sheetWin.announce:Hide() end
  K.front(sheetWin)
  sheetWin:Show()
end
function RA.HideSheet() if sheetWin then sheetWin:Hide() end end
-- /fr boss : la fiche du boss ciblé, sinon la première du raid
function RA.ShowSheetCommand()
  local s = RA.SheetFor("target") or RA.Sheets()[1]
  if not s then ns.print("aucune fiche de boss pour ce raid (sur le site : page du raid, onglet Préparation, puis synchro).") return end
  RA.dismissed[s.name] = nil
  RA.ShowSheet(s)
end
RA.sheetWindow = function() return sheetWin end

--------------------------------------------------------------------------------------------------------------------
-- Onglet « En raid »
--------------------------------------------------------------------------------------------------------------------
function RA.FillTab(L)
  local d = RA.Current()
  L.Header("Raid")
  if d then
    local e = d.entry
    L.Add(GOLD .. e.raid.name .. "|r  " .. (e.raid.time > 0 and date("%d/%m %H:%M", e.raid.time) or "") .. GREY .. "  · " .. e.group.name
      .. (ns.Recorder.Current() and "  · relevé en cours" or "") .. (RA.IsMasterLooter() and "  · tu es maître du butin" or "") .. "|r",
      { { "Fenêtre du butin", 150, function() RA.ShowLoot() end } })
  else
    L.Add(GREY .. "Pas de raid du site dans les 2 h : charge les données du site (onglet Synchro) avant le raid.|r", { { "Fenêtre du butin", 150, function() RA.ShowLoot() end } })
  end

  if IsInGroup and IsInGroup() then
    local rows = RA.VersionRows()
    local ok, old, none, wait = {}, {}, {}, {}
    for _, r in ipairs(rows) do
      if r.state == "ok" then ok[#ok + 1] = r.name elseif r.state == "old" then old[#old + 1] = r.name .. " (" .. r.v .. ")" elseif r.state == "none" then none[#none + 1] = r.name else wait[#wait + 1] = r.name end
    end
    L.Header("Addon dans le raid · " .. (#ok + #old) .. "/" .. #rows)
    if #ok > 0 then L.Add(GREEN .. "À jour : |r" .. names(ok, 10)) end
    if #old > 0 then L.Add(ORANGE .. "À mettre à jour : |r" .. table.concat(old, ", ") .. GREY .. "\nAncienne version : ni conseil du butin ni appel aux consommables.|r") end
    if #none > 0 then L.Add(RED .. "Pas d'addon : |r" .. table.concat(none, ", ") .. GREY .. "\nIls peuvent toujours /roll, ou chuchoter leur réponse au conseil.|r") end
    if #wait > 0 then L.Add(GREY .. "En attente de réponse : " .. names(wait, 10) .. "|r") end
    L.Add(GREY .. "La question part à l'arrivée dans un raid.|r", { { "Redemander", 120, function() RA.AskVersions(true) C_Timer.After(5, function() ns.UI.Refresh() end) ns.UI.Refresh() end } })
  end

  local list = d and d.consumables or {}
  L.Header("Consommables")
  if #list == 0 then
    L.Add(GREY .. "Aucun consommable demandé pour ce raid (site : page du raid, onglet Préparation).|r")
  else
    local want = {}
    for _, c in ipairs(list) do want[#want + 1] = (c.name ~= "" and c.name or ("objet " .. c.itemId)) .. " ×" .. c.n end
    L.Add(GREY .. "Demandé : |r" .. table.concat(want, ", "))
    local s = RA.CallSummary()
    if s then
      L.Add(string.format("Appel de %s%s|r par %s : %s%d prêt(s)|r · %s%d incomplet(s)|r · %s%d sans réponse|r%s", GOLD, date("%H:%M", RA.call.at), RA.call.by,
        GREEN, #s.ready, ORANGE, #s.missing, RED, #s.silent, RA.call.open and (GREY .. " (réponses en cours)|r") or ""))
      for _, m in ipairs(s.missing) do L.Add(m.name .. "  " .. GREY .. table.concat(m.lacks, ", ") .. "|r") end
      if #s.silent > 0 then L.Add(RED .. "Sans réponse : |r" .. names(s.silent, 12)) end
    end
    local buttons = {}
    if RA.isLeader() then buttons[#buttons + 1] = { "Appel aux consommables", 200, function() RA.CallConsumables() end } end
    if s and RA.isLeader() then buttons[#buttons + 1] = { "Annoncer les manques", 180, function() RA.AnnounceMissing() end } end
    L.Add(GREY .. "Chaque addon répond avec ce qu'il a dans ses sacs ; le résultat part au site avec ta synchro.|r", buttons)
  end

  local hand = RA.Handover()
  L.Header("Objets à remettre · " .. #hand)
  if #hand == 0 then L.Add(GREY .. "Aucun. « Garder, à remettre » dans la fenêtre du butin les ajoute ici.|r") end
  for _, h in ipairs(hand) do
    local left, secs = remaining(h.at)
    L.Add(linkFor(h.itemId, h.link) .. " → " .. GOLD .. h.winner .. "|r  " .. (secs < 1800 and ORANGE or GREY) .. left .. " pour l'échanger|r",
      { { "Échanger", 110, function() RA.Trade(h) end }, { "Retirer", 90, function()
        local all = RA.Handover()
        for i = #all, 1, -1 do if all[i] == h then table.remove(all, i) end end
        ns.UI.Refresh()
      end } })
  end

  local sheets = RA.Sheets()
  L.Header("Fiches de boss · " .. #sheets)
  if #sheets == 0 then L.Add(GREY .. "Aucune fiche pour ce raid (site : onglet Préparation du raid).|r")
  else
    local mine = {}
    for _, s in ipairs(sheets) do local t = RA.MyTasks(s) if #t > 0 then mine[#mine + 1] = s.name .. " : " .. table.concat(t, ", ") end end
    L.Add((#mine > 0 and ("Tes tâches : " .. table.concat(mine, " · ")) or GREY .. "Pas de tâche pour toi.|r") .. "\n" .. GREY .. "La fiche s'ouvre en ciblant le boss, avant le pull.|r",
      { { "Voir une fiche", 140, function() RA.ShowSheetCommand() end } })
  end
end

function RA.RefreshWindows()
  ns.safe("butin", RA.RefreshLoot)
  ns.safe("conseil", RA.RefreshCouncil)
end
