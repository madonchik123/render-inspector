
local frame, exported, actualCalls = 100, nil, 0
local function value(class, fields)
	local v = newproxy(true)
	local mt = getmetatable(v)
	mt.__name = class
	mt.__index = fields
	return v
end
local pointFields = {x = 10, y = 20}
local point = value("Vec2", pointFields)
local color = value("Color", {r = 1, g = 2, b = 3, a = 255})
local render = {
	ScreenSize = function() return {x = 1920, y = 1080} end,
	FilledRect = function(...) actualCalls += 1; assert(select(1, ...) == point); return nil, 7, nil end,
	LoadFont = function(...) return 42 end,
	Text = function(...) actualCalls += 1 end,
	RenderRT = function(cb) cb(); return true end,
	Throw = function() error("original failure") end,
}
local originals = table.clone(render)
local buttons, labels = {}, {}
local function widget(text)
	return {text = text, Name = function(self, name) self.text = name end,
		Disabled = function(self, disabled) self.disabled = disabled end, ToolTip = function() end}
end
local menu = {Create = function()
	return {Label = function(_, text) local item = widget(text); labels[#labels + 1] = item; return item end,
		Button = function(_, text, callback) local item = widget(text); item.click = callback; buttons[#buttons + 1] = item; return item end}
end}
local libraryCalls = 0
local library = {default_font = 3, default_font_awesome = 8, text = function(...) libraryCalls += 1; return 9 end}
local originalLibraryText = library.text
local json = {newArray = function() return {} end, encode = function(_, data) exported = data; return "{}" end}
local fakeIo = {open = function() return {write = function(self) return self end, close = function() return true end} end}
local xhelpers = {XRender = {DrawAlert = function() render.Text('alert') end},GetModuleList = function() return {} end,GetScriptList = function() return {} end}
local legacy = {DrawFilledRect = function(...) return nil, 8 end, SetDrawColor = function() end, LoadFont = function() return 42 end}
local legacyOriginal = legacy.DrawFilledRect
local recorder = install(render, library, xhelpers, menu, {GetCheatDirectory = function() return "C:/Umbrella" end},
	{GetFrameCount = function() return frame end}, function() return json end, fakeIo, debug, legacy)
assert(render.ScreenSize == originals.ScreenSize, "Queries remain untouched")
assert(render.LoadFont("Arial") == 42)
recorder.OnScriptsLoaded()
frame += 40
recorder.OnUpdateEx()
assert(exported == nil, "Loading scripts must not capture or write a file")
assert(recorder.export() == false, "No capture exists until explicitly requested")
assert(#buttons == 2)
buttons[1].click()
recorder.OnUpdateEx()
assert(buttons[1].disabled and buttons[2].disabled)
assert(recorder.capture(30) == false, "A second capture must not discard the current one")
frame += 1
local result = table.pack(render.FilledRect(point, point, color, nil, 2))
assert(result.n == 3 and result[1] == nil and result[2] == 7 and result[3] == nil)
pointFields.x = 99
render.RenderRT(function() render.Text(42, 14, "nested", point, color) end)
assert(library.text(3, 14, point, "helper") == 9)
frame += 1
recorder.OnUpdateEx()
assert(#exported.calls == 4 and actualCalls == 2 and libraryCalls == 1)
assert(exported.calls[4].library == "LIB_RENDER" and exported.calls[4].method == "text")
assert(exported.calls[1].args[1].x == 10, "Snapshot is immutable")
assert(exported.calls[1].args[4].kind == "nil", "Nil argument preserved")
assert(exported.calls[2].method == "RenderRT" and exported.calls[3].method == "Text", "Nested draw order")
assert(exported.calls[3].parentId == 2 and exported.calls[4].parentId == nil)
assert(exported.resources['Render:LoadFont:42'].args[1] == "Arial")
assert(exported.calls[1].results[2] == 7)
assert(exported.calls[2].args[1].kind == "function", "Do not retain callback")
assert(labels[1].text:find("Saved 4 calls", 1, true))
assert(not buttons[1].disabled and not buttons[2].disabled)
recorder.capture(1)
frame += 1
local cyclic = {};cyclic.self = cyclic
render.Text(cyclic)
assert(not pcall(render.Throw), "Native errors still propagate")
for i = 1, 1510 do render.Text("budget") end
frame += 1;recorder.OnUpdateEx()
assert(#exported.calls == 1500 and exported.dropped == 12)
assert(exported.calls[1].args[1].entries[1].value.kind == "cycle")
assert(exported.calls[2].completed == false)
assert(exported.calls[3].parentId == nil, "Error must not poison nesting")
assert(recorder.discover() == 0)
recorder.capture(1);frame += 1;xhelpers.XRender.DrawAlert();frame += 1;recorder.OnUpdateEx()
assert(exported.calls[1].library == 'XHelpers.XRender' and exported.calls[2].parentId == 1)
assert(legacy.LoadFont('Tahoma', 22) == 42)
recorder.capture(1);frame += 1
legacy.SetDrawColor(1, 2, 3, 255)
local legacyResult = table.pack(legacy.DrawFilledRect(10, 20, 30, 40))
assert(legacyResult.n == 2 and legacyResult[1] == nil and legacyResult[2] == 8)
frame += 1;recorder.OnUpdateEx()
assert(#exported.calls == 2 and exported.calls[1].method == 'SetDrawColor')
assert(exported.calls[2].library == 'Renderer' and exported.calls[2].args[3] == 30)
assert(exported.resources['Renderer:LoadFont:42'].args[1] == 'Tahoma')
assert(exported.resources['Render:LoadFont:42'].args[1] == 'Arial')
local discovered = false
xhelpers.XRender.DrawNewPanel = function() discovered = true end
buttons[2].click()
frame += 1;xhelpers.XRender.DrawNewPanel()
frame += 30;recorder.OnUpdateEx()
assert(discovered and #exported.calls == 1, "Capture buttons refresh discovery automatically")
assert(exported.lastFrame - exported.firstFrame == 29)
buttons[1].click();frame += 2;recorder.OnUpdateEx()
assert(labels[1].text:find("Saved 0 calls", 1, true))
local replacement = function() end
render.Text = replacement
recorder.stop()
assert(render.FilledRect == originals.FilledRect and render.Text == replacement and render.__recorder == nil)
assert(library.text == originalLibraryText)
assert(legacy.DrawFilledRect == legacyOriginal)
print("PASS: forwarding, nil returns, snapshots, resources, RT nesting, errors, caps, restoration")
