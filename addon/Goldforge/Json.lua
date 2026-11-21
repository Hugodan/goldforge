-- Minimal JSON encoder for the export string (WoW has no JSON library).
local _, ns = ...

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function escapeString(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return escapes[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function isArray(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then return false end
    n = n + 1
  end
  for i = 1, n do if t[i] == nil then return false end end
  return true, n
end

local encode
encode = function(v, out)
  local tv = type(v)
  if tv == "nil" then
    out[#out + 1] = "null"
  elseif tv == "boolean" then
    out[#out + 1] = v and "true" or "false"
  elseif tv == "number" then
    if v ~= v or v == math.huge or v == -math.huge then
      out[#out + 1] = "null"
    elseif v % 1 == 0 and v > -1e15 and v < 1e15 then
      out[#out + 1] = string.format("%d", v)
    else
      out[#out + 1] = string.format("%.4f", v)
    end
  elseif tv == "string" then
    out[#out + 1] = escapeString(v)
  elseif tv == "table" then
    local arr, n = isArray(v)
    if arr and n > 0 then
      out[#out + 1] = "["
      for i = 1, n do
        if i > 1 then out[#out + 1] = "," end
        encode(v[i], out)
      end
      out[#out + 1] = "]"
    else
      out[#out + 1] = "{"
      local first = true
      for k, val in pairs(v) do
        if type(val) ~= "function" then
          if not first then out[#out + 1] = "," end
          first = false
          out[#out + 1] = escapeString(tostring(k))
          out[#out + 1] = ":"
          encode(val, out)
        end
      end
      out[#out + 1] = "}"
    end
  else
    out[#out + 1] = "null"
  end
end

function ns.ToJSON(v)
  local out = {}
  encode(v, out)
  return table.concat(out)
end
