local recorder = {}
local JSON = require("assets.JSON")

local cfg = {
	maxCalls = 12000,
	maxFrameCalls = 1500,
	maxValueNodes = 128,
	maxText = 2048,
	maxResources = 512,
	maxSnapshotBytes = 8 * 1024 * 1024,
	output = Engine.GetCheatDirectory() .. "/render calls",
}
local queries = {ScreenSize = true, TextSize = true, ImageSize = true, WorldToScreen = true}
local loaders = {LoadFont = true, LoadImage = true, LoadSvg = true, LoadSvgString = true, FindOrCreateRT = true}
local libraryMethods = {
	filled_triagle = true, pop_clip = true, image = true, filled_rect = true,
	glow_circle = true, outline_rect = true, draw_hero_indicator = true,
	centered_notification = true, gradient_circle = true, clip = true, text = true,
	blur = true, skill_cooldown_icon = true, render_skill_indicator = true,
	line = true, gradient = true, glow = true, triagle = true, simple_int_ind = true,
	hud_error = true, side_notification = true, line_arrowed = true,
	filled_circle = true, circle = true, load_image = true, font = true,
}

if Render.__recorder then Render.__recorder.stop() end
local state = {
	hooks = {}, resources = {}, resourceCount = 0, resourceDropped = 0,
	active = false, pendingExport = false, frameCounts = {},
	calls = {}, sources = {}, sourceIds = {}, dropped = 0,
	snapshotBytes = 0,
	installed = true,
	owners = {}, audit = {}, parentId = nil,
}
local helpers = {}

-- Snapshots never keep caller-owned tables, callbacks, or native userdata alive.
function helpers.snapshot(value, budget, depth, seen)
	budget.left = budget.left - 1
	if budget.left < 0 then return {kind = "truncated"} end
	local kind = type(value)
	if kind == "nil" then return {kind = "nil"} end
	if kind == "boolean" then return value end
	if kind == "number" then
		if value ~= value or math.abs(value) == math.huge then return tostring(value) end
		return value
	end
	if kind == "string" then
		local limit = math.min(cfg.maxText, budget.textLeft)
		local text = value:sub(1, limit)
		budget.textLeft = budget.textLeft - #text
		if #value > limit then text = text .. " [truncated]" end
		return text
	end
	if kind == "userdata" then
		local meta = getmetatable(value)
		local name = type(meta) == "table" and meta.__name or "userdata"
		if name == "Vec2" then return {kind = "Vec2", x = value.x, y = value.y} end
		if name == "Vector" then return {kind = "Vector", x = value.x, y = value.y, z = value.z} end
		if name == "Color" then return {kind = "Color", r = value.r, g = value.g, b = value.b, a = value.a} end
		return {kind = "userdata", class = name}
	end
	if kind ~= "table" then return {kind = kind} end
	if seen[value] then return {kind = "cycle"} end
	if depth >= 4 then return {kind = "depthLimit"} end
	seen[value] = true
	local entries = JSON:newArray()
	for key, item in next, value do
		if budget.left < 2 then
			entries[#entries + 1] = {kind = "truncated"}
			break
		end
		entries[#entries + 1] = {
			key = helpers.snapshot(key, budget, depth + 1, seen),
			value = helpers.snapshot(item, budget, depth + 1, seen),
		}
	end
	seen[value] = nil
	return {kind = "table", entries = entries}
end

function helpers.arguments(...)
	local result = JSON:newArray()
	local budget = {left = cfg.maxValueNodes, textLeft = 8192}
	for index = 1, select("#", ...) do
		result[index] = helpers.snapshot(select(index, ...), budget, 0, {})
	end
	return result, (cfg.maxValueNodes - budget.left) * 64 + 8192 - budget.textLeft
end

function helpers.beforeCall(name, ...)
	if not state.active then return nil end
	local frame = GlobalVars.GetFrameCount()
	if frame < state.firstFrame or frame > state.lastFrame then return nil end
	local frameCount = state.frameCounts[frame] or 0
	if #state.calls >= cfg.maxCalls or frameCount >= cfg.maxFrameCalls or state.snapshotBytes >= cfg.maxSnapshotBytes then
		state.dropped = state.dropped + 1
		return nil
	end
	local trace = debug.traceback("", 3):sub(1, 4096)
	local sourceId = state.sourceIds[trace]
	if not sourceId then
		sourceId = #state.sources + 1
		state.sources[sourceId] = trace
		state.sourceIds[trace] = sourceId
		state.snapshotBytes = state.snapshotBytes + #trace
	end
	local args, size = helpers.arguments(...)
	state.snapshotBytes = state.snapshotBytes + size
	local call = {
		id = #state.calls + 1, frame = frame, method = name, source = sourceId,
		args = args, completed = false, parentId = state.parentId,
	}
	state.calls[#state.calls + 1] = call
	state.frameCounts[frame] = frameCount + 1
	return call
end

function helpers.install(name, original, owner, library)
	state.owners[owner] = state.owners[owner] or {}
	if state.owners[owner][name] then return end
	state.owners[owner][name] = true
	local isLoader = (library == "Render" or library == "Renderer") and loaders[name]
	local hook = function(...)
		if not state.active and not isLoader then return original(...) end
		local call = helpers.beforeCall(name, ...)
		if call then call.library = library end
		local resourceArgs
		if isLoader and state.installed then resourceArgs = helpers.arguments(...) end
		local results
		if call then
			local parentId = state.parentId
			state.parentId = call.id
			-- Restore nesting even on a Lua error, then rethrow the original error.
			local outcome = table.pack(pcall(original, ...))
			state.parentId = parentId
			if not outcome[1] then
				call.error = tostring(outcome[2]):sub(1, cfg.maxText)
				error(outcome[2], 0)
			end
			results = {n = outcome.n - 1}
			for index = 2, outcome.n do results[index - 1] = outcome[index] end
		else
			results = table.pack(original(...))
		end
		if call then
			call.completed = true
			local values, size = helpers.arguments(table.unpack(results, 1, results.n))
			call.results = values
			state.snapshotBytes = state.snapshotBytes + size
		end
		if resourceArgs then
			local key = library .. ":" .. name .. ":" .. tostring(results[1])
			if state.resources[key] or state.resourceCount < cfg.maxResources then
				if not state.resources[key] then state.resourceCount = state.resourceCount + 1 end
				state.resources[key] = {library = library, method = name, args = resourceArgs, result = results[1]}
			else
				state.resourceDropped = state.resourceDropped + 1
			end
		end
		return table.unpack(results, 1, results.n)
	end
	state.hooks[library .. "." .. name] = {original = original, hook = hook, owner = owner, name = name}
	owner[name] = hook
end

local function drawMethod(name)
	local lower = name:lower()
	return libraryMethods[name] or lower:find("draw", 1, true) ~= nil
		or lower:find("render", 1, true) ~= nil or lower == "circleinworld"
end

-- Explicit registration also covers custom helper tables not exported by XHelpers.
function recorder.watch(owner, label, names)
	if type(owner) ~= "table" or getmetatable(owner) ~= nil then return 0 end
	local count, functions = 0, {}
	for name, value in next, owner do
		if type(name) == "string" and type(value) == "function" and name:sub(1, 2) ~= "On" then
			if (names and names[name]) or (not names and drawMethod(name)) then functions[name] = value end
		end
	end
	for name, value in pairs(functions) do
		if not state.owners[owner] or not state.owners[owner][name] then
			helpers.install(name, value, owner, label)
			count = count + 1
		end
	end
	return count
end

function recorder.discover()
	local visited, queue, head = {}, {}, 1
	local function add(value, label, depth)
		if type(value) ~= "table" or visited[value] or getmetatable(value) ~= nil then return end
		visited[value] = true
		queue[#queue + 1] = {value = value, label = label, depth = depth}
	end
	add(XHelpers.XRender, "XHelpers.XRender", 0)
	add(XHelpers, "XHelpers", 0)
	add(Panel, "Panel", 0)
	add(Panels, "Panels", 0)
	if type(Renderer) == "table" then
		local methods = {}
		for name, value in next, Renderer do
			if type(value) == "function" and (name:find("Draw", 1, true) or name == "PushClip" or name == "PopClip" or name == "LoadFont" or name == "LoadImage") then methods[name] = true end
		end
		recorder.watch(Renderer, "Renderer", methods)
	end
	for key, value in pairs(XHelpers.GetModuleList()) do
		local name = type(value) == "string" and value or key
		if type(name) == "string" then add(XHelpers.GetModule(name), "module:" .. name, 0) end
	end
	for key, value in pairs(XHelpers.GetScriptList()) do
		local name = type(value) == "string" and value or key
		if type(name) == "string" then
			local exported = XHelpers.GetScript(name)
			if exported ~= recorder then add(exported, "script:" .. name, 0) end
		end
	end
	local scanned, added, edges = 0, 0, 0
	while head <= #queue and scanned < 512 and edges < 20000 do
		local item = queue[head]
		head, scanned = head + 1, scanned + 1
		added = added + recorder.watch(item.value, item.label)
		if item.depth < 3 then
			for key, value in next, item.value do
				edges = edges + 1
				if edges >= 20000 then break end
				if type(key) == "string" and value ~= recorder then add(value, item.label .. "." .. key, item.depth + 1) end
			end
		end
	end
	state.audit = {scannedTables = scanned, inspectedEntries = edges, addedHooks = added,
		limited = head <= #queue or edges >= 20000,
		limits = "Exported plain Lua tables only; depth 3, 512 tables, 20000 entries. Local upvalues and native draw paths are unavailable."}
	return added
end

function recorder.capture(frameCount)
	if not state.installed then return false end
	frameCount = math.max(1, math.min(120, math.floor(frameCount or 30)))
	state.calls, state.sources = JSON:newArray(), JSON:newArray()
	state.sourceIds, state.frameCounts = {}, {}
	state.parentId = nil
	state.dropped = 0
	state.label = "User UI capture"
	state.snapshotBytes = 0
	state.firstFrame = GlobalVars.GetFrameCount() + 1
	state.lastFrame = state.firstFrame + frameCount - 1
	local size = Render.ScreenSize()
	state.screen = {width = size.x, height = size.y}
	state.active, state.pendingExport = true, false
	print("[render-proxy] Capturing next " .. frameCount .. " frames.")
	return true
end

function recorder.demo()
	if not state.installed then return false end
	state.demoFont = Render.LoadFont("Arial", 0, 500)
	recorder.capture(30)
	state.label = "TEST PANEL ONLY - recorder validation"
	state.demoUntil = state.lastFrame
	return true
end

function recorder.OnFrame()
	if not state.demoUntil or GlobalVars.GetFrameCount() > state.demoUntil then return end
	local size = Render.ScreenSize()
	local x, y = size.x * 0.35, size.y * 0.25
	Render.Shadow(Vec2(x, y), Vec2(x + 420, y + 180), Color(0, 0, 0, 160), 16, 10)
	Render.FilledRect(Vec2(x, y), Vec2(x + 420, y + 180), Color(20, 31, 45, 245), 10)
	Render.Rect(Vec2(x, y), Vec2(x + 420, y + 180), Color(77, 180, 175, 255), 10, 0, 1)
	Render.PushClip(Vec2(x + 12, y + 12), Vec2(x + 408, y + 168), true)
	Render.Text(state.demoFont, 19, "Render proxy - TEST PANEL", Vec2(x + 20, y + 20), Color(225, 240, 250))
	Render.Text(state.demoFont, 14, "Recorded primitives, not native menu UI", Vec2(x + 20, y + 52), Color(140, 166, 185))
	Render.FilledRect(Vec2(x + 20, y + 90), Vec2(x + 290, y + 132), Color(35, 111, 116), 6)
	Render.Text(state.demoFont, 15, "Select and copy this part", Vec2(x + 32, y + 101), Color(240, 255, 255))
	Render.PopClip()
end

function recorder.finish()
	if not state.active then return end
	state.active, state.pendingExport = false, true
end

function recorder.export()
	if not state.firstFrame then return false end
	local hooks = JSON:newArray()
	for name, entry in pairs(state.hooks) do
		hooks[#hooks + 1] = {name = name, installed = entry.owner[entry.name] == entry.hook}
	end
	table.sort(hooks, function(a, b) return a.name < b.name end)
	local data = {
		version = 2, screen = state.screen, discovery = state.audit,
		label = state.label,
		firstFrame = state.firstFrame, lastFrame = state.lastFrame,
		calls = state.calls, sources = state.sources,
		resources = state.resources, resourceDropped = state.resourceDropped,
		dropped = state.dropped, hooks = hooks,
		snapshotBytesEstimate = state.snapshotBytes,
		coverage = "Render v2, Renderer v1 when present, LIB_RENDER, and discovered exported Lua drawing helpers. Inspect hooks and discovery limits. Native UI, Panorama, local upvalues and cached function aliases may bypass capture.",
		preview = "Geometry inspection only. Clip, rotation, alpha, shaders, textures, render targets and font metrics are not replayed.",
	}
	local encoded = JSON:encode(data)
	local file, err = io.open(cfg.output .. ".json", "w")
	if not file then
		print("[render-proxy] Export failed: " .. tostring(err))
		return false
	end
	local written, writeError = file:write(encoded)
	local closed, closeError = file:close()
	if not written or not closed then
		print("[render-proxy] Export failed: " .. tostring(writeError or closeError))
		return false
	end
	print("[render-proxy] Exported " .. #state.calls .. " calls, " .. #state.sources
		.. " sources, " .. state.dropped .. " dropped to " .. cfg.output .. ".json")
	return true
end

function recorder.stop()
	recorder.finish()
	for name, entry in pairs(state.hooks) do
		if entry.owner[entry.name] == entry.hook then entry.owner[entry.name] = entry.original end
	end
	if Render.__recorder == recorder then Render.__recorder = nil end
	state.installed = false
end

function recorder.OnScriptsLoaded()
	recorder.discover()
end

function recorder.OnUpdateEx()
	if state.active and GlobalVars.GetFrameCount() > state.lastFrame then recorder.finish() end
	if state.pendingExport then
		state.pendingExport = false
		recorder.export()
	end
end

-- Only functions already present in the plain Lua table are wrapped.
local functions = {}
for name, value in next, Render do
	if type(value) == "function" and not queries[name] then functions[name] = value end
end
for name, original in pairs(functions) do helpers.install(name, original, Render, "Render") end
for name, value in next, LIB_RENDER do
	if libraryMethods[name] and type(value) == "function" then helpers.install(name, value, LIB_RENDER, "LIB_RENDER") end
end
state.resources["LIB_RENDER.default_font"] = {library = "LIB_RENDER", method = "default_font", result = LIB_RENDER.default_font, args = JSON:newArray()}
state.resources["LIB_RENDER.default_font_awesome"] = {library = "LIB_RENDER", method = "default_font_awesome", result = LIB_RENDER.default_font_awesome, args = JSON:newArray()}
Render.__recorder = recorder

local group = Menu.Create("Scripts", "Tools", "Render Inspector", "Capture", "Recorder")
group:Label("Open the target panel, then capture a short sample.")
group:Button("Capture next frame", function() recorder.capture(1) end)
group:Button("Capture next 30 frames", function() recorder.capture(30) end)
group:Button("Finish capture", function() recorder.finish() end)
group:Button("Export last capture", function() recorder.export() end)
group:Button("Capture test panel", function() recorder.demo() end)
group:Button("Discover drawing helpers", function() recorder.discover() end)
group:Button("Stop render proxy", function() recorder.stop() end)

return recorder
