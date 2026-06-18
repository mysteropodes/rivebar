## RiveBar MCP Script Guidelines — For AI Assistants

You are helping a user create automation scripts for RiveBar, a tool that controls Rive (design & animation software) via MCP (Model Context Protocol).

### Script Format

A script is a JSON object with these fields:
- `title` (string) — display name
- `description` (string) — what the script does
- `icon` (string) — icon name (see list at the end)
- `category` (string) — e.g. "rigging", "design", "utility", "animation", "layout"
- `tags` (string[]) — search keywords
- `hasUi` (boolean) — true if the script has _ui steps
- `steps` (array) — ordered list of step objects

---

### How the Execution Engine Works

The engine runs steps sequentially. It maintains two shared stores:
- **`vars`** — a key/value dictionary. Populated by `extract` on tool steps and by `_ui` field results. Accessed in args via `{{varName}}` or `{{json:varName}}`.
- **`results`** — an object indexed by step number. `results[0]` = raw JSON text from step 0's tool result.

**IMPORTANT**: There is NO `steps[N].result` syntax. Variables are the only way to pass data between step args. In `_compute`, use `vars` and `results[N]`.

---

### Step Types

#### 1. MCP Tool Step
Calls a Rive MCP tool. The `args` field is a JSON string (or object) that gets variable-interpolated before parsing.
```json
{
  "tool": "tool_name",
  "args": "{ \"param1\": \"{{myVar}}\" }",
  "extract": { "outputVar": "path.to.field" },
  "label": "Human-readable description"
}
```
- `args` — JSON string or object, supports `{{var}}` interpolation
- `extract` (optional) — pulls values from the result into `vars`
- `label` (optional) — shown in the step list

#### 2. _compute Step (JavaScript)
Runs JavaScript via `new Function('vars', 'results', 'setVar', code)`.
Your code has access to:
- **`vars`** — the shared variable dictionary (read/write directly)
- **`results`** — raw result strings from previous tool calls, keyed by step index
- **`setVar(name, value)`** — helper to set a variable

The code goes in the **`args`** field (NOT in a `code` field).

```json
{
  "tool": "_compute",
  "args": "const data = JSON.parse(results[0]); setVar('artboardId', data.id); setVar('name', data.name);",
  "label": "Extract artboard info"
}
```

To stop the script with an error:
```json
{
  "tool": "_compute",
  "args": "if (!vars.meshId) throw new Error('Select a mesh first');",
  "label": "Validate selection"
}
```

#### 3. _ui Step (Interactive Modal)
Shows a form to the user. Each field's value goes into `vars` using the field's `key` as variable name.

```json
{
  "tool": "_ui",
  "ui": {
    "title": "Configuration",
    "fields": [
      { "key": "name", "label": "Name", "type": "text", "default": "Artboard 1" },
      { "key": "width", "label": "Width", "type": "number", "default": 500 },
      { "key": "useLayout", "label": "Enable Layout", "type": "checkbox", "default": false },
      { "key": "preset", "label": "Preset", "type": "select", "options": ["A","B","C"], "default": "A" }
    ]
  },
  "label": "Ask user for settings"
}
```

After the user submits, `vars.name`, `vars.width`, etc. are all set directly.

**Field types:** `text`, `number`, `checkbox`, `select`, `color`, `textarea`, `slider`

**Defaults can use variables:** `"default": "{{previousVar}}"` — values are interpolated.

#### 3b. _ui Step: Custom HTML Mode

For advanced UIs, provide raw HTML. The HTML must call `window._uiResolve(valuesObject)` to submit.

```json
{
  "tool": "_ui",
  "ui": {
    "title": "Advanced Settings",
    "width": 500,
    "height": 300,
    "html": "<div><input id='radius' type='range' min='0' max='100' value='50'><br><button onclick=\"window._uiResolve({ radius: document.getElementById('radius').value })\">Apply</button></div>"
  },
  "label": "Custom UI"
}
```

The object passed to `_uiResolve` is merged into `vars`.

---

### Variable Interpolation ({{...}})

In tool step `args`, use:
- `{{varName}}` — replaced with the string value of `vars.varName`
- `{{json:varName}}` — replaced with the raw JSON of the value (for objects/arrays)

Example:
```json
{
  "tool": "get_artboard_hierarchy",
  "args": "{ \"artboard_id\": \"{{artboardId}}\" }",
  "label": "Get hierarchy"
}
```

---

### Extract Variables from Tool Results

Tool steps can auto-extract values from their JSON result into `vars`:
```json
{
  "tool": "list_artboards",
  "args": "{}",
  "extract": {
    "artboardId": "artboards[?isCurrent].id",
    "artboardName": "artboards[?isCurrent].name"
  },
  "label": "Get current artboard"
}
```

**Path syntax:**
- `field.subfield` — dot notation
- `array[?prop]` — find first element where `prop` is truthy

---

### Available MCP Tools

**Artboards:**
- `list_artboards` — list all artboards (returns array with id, name, isCurrent...)
- `open_file_editor` — manage artboards (action: create_artboard, rename, arrange, focus)
- `get_artboard_hierarchy` — get full node tree (needs artboard_id)

**Objects:**
- `find_objects` — search by name/type
- `get_selection` — get currently selected objects
- `select_objects` — select objects by ID
- `set_property_values` — change properties (position, color, size, opacity, rotation...)
- `query_property_keys` — list available properties for an object type
- `query_property_values` — read property values
- `delete_objects` — delete objects by ID
- `rename_objects` — rename objects (takes array of {id, name})
- `reparent_objects` — move objects to a new parent
- `reorder_objects` — change z-order
- `duplicate_objects` — duplicate objects

**Design:**
- `path_editor` — edit paths/vertices (action: get_vertices, set_vertices...)
- `text_editor` — edit text content
- `layout_editor` — create/modify layouts (flexbox-like)
- `component_editor` — manage components

**Animation:**
- `animation_editor` — create/edit animations and keyframes

**Scripts:**
- `manage_scripts` — create/edit Luau scripts
- `get_scripts` — list scripts
- `script_diagnostics` — check for errors
- `run_tests` — execute test suites

**Data:**
- `viewmodel_editor` — manage ViewModels (data binding)
- `query_objects` — advanced object queries

---

### Complete Example: Auto-Skin Script

Binds mesh vertices to nearby bones. Uses `setVar` in _compute and `{{var}}` in args.

```json
{
  "title": "Auto-Skin",
  "description": "Bind mesh vertices to nearest bones",
  "icon": "bone",
  "category": "rigging",
  "tags": ["bones", "mesh", "weights"],
  "hasUi": false,
  "steps": [
    {
      "tool": "get_selection",
      "args": "{}",
      "label": "Get selected mesh"
    },
    {
      "tool": "_compute",
      "args": "const sel = JSON.parse(results[0]); const items = sel.content ? JSON.parse(sel.content[0].text) : sel; const mesh = (Array.isArray(items) ? items : [items]).find(o => o.type === 'mesh'); if (!mesh) throw new Error('Select a mesh first'); setVar('meshId', mesh.id); setVar('meshName', mesh.name); setVar('artboardId', mesh.artboardId || '');",
      "label": "Find mesh in selection"
    },
    {
      "tool": "get_artboard_hierarchy",
      "args": "{ \"artboard_id\": \"{{artboardId}}\" }",
      "label": "Get hierarchy to find bones"
    },
    {
      "tool": "_compute",
      "args": "const hier = JSON.parse(results[2]); function findBones(n, list) { if (n.type === 'bone') list.push(n); if (n.children) n.children.forEach(c => findBones(c, list)); return list; } const bones = findBones(hier, []); if (!bones.length) throw new Error('No bones found'); setVar('boneIds', JSON.stringify(bones.map(b => b.id))); setVar('boneCount', String(bones.length));",
      "label": "Extract all bones"
    },
    {
      "tool": "path_editor",
      "args": "{ \"action\": \"get_vertices\", \"object_id\": \"{{meshId}}\" }",
      "label": "Get mesh vertices"
    }
  ]
}
```

### Complete Example: Quick Artboard with UI

Uses `_ui` fields that populate `vars` directly, then `_compute` to resolve presets.

```json
{
  "title": "Quick Artboard",
  "description": "Create artboard with device presets",
  "icon": "artboard",
  "category": "design",
  "tags": ["artboard", "create"],
  "hasUi": true,
  "steps": [
    {
      "tool": "_ui",
      "ui": {
        "title": "New Artboard",
        "fields": [
          { "key": "name", "label": "Name", "type": "text", "default": "Screen 1" },
          { "key": "device", "label": "Device", "type": "select", "options": ["Custom","iPhone 15 (393x852)","iPad (1024x1366)","Desktop (1440x900)"], "default": "Custom" },
          { "key": "width", "label": "Width", "type": "number", "default": 375 },
          { "key": "height", "label": "Height", "type": "number", "default": 812 }
        ]
      },
      "label": "Configure artboard"
    },
    {
      "tool": "_compute",
      "args": "const presets = { 'iPhone 15 (393x852)': [393,852], 'iPad (1024x1366)': [1024,1366], 'Desktop (1440x900)': [1440,900] }; const p = presets[vars.device]; if (p) { setVar('width', String(p[0])); setVar('height', String(p[1])); }",
      "label": "Resolve device preset"
    },
    {
      "tool": "open_file_editor",
      "args": "{ \"action\": \"create_artboard\", \"name\": \"{{name}}\", \"width\": {{width}}, \"height\": {{height}} }",
      "label": "Create artboard"
    }
  ]
}
```

### Complete Example: Batch Rename

Uses `_ui` for user input, `extract` to get artboard, `_compute` to build rename list, `{{json:var}}` to pass array.

```json
{
  "title": "Batch Rename",
  "description": "Rename objects matching a pattern",
  "icon": "edit",
  "category": "utility",
  "tags": ["rename", "batch"],
  "hasUi": true,
  "steps": [
    {
      "tool": "_ui",
      "ui": {
        "title": "Batch Rename",
        "fields": [
          { "key": "search", "label": "Find (in name)", "type": "text" },
          { "key": "replace", "label": "Replace with", "type": "text" }
        ]
      },
      "label": "Rename settings"
    },
    {
      "tool": "list_artboards",
      "args": "{}",
      "label": "List artboards"
    },
    {
      "tool": "_compute",
      "args": "const abs = JSON.parse(results[1]); const list = Array.isArray(abs) ? abs : abs.artboards || []; const cur = list.find(a => a.isCurrent) || list[0]; setVar('artboardId', cur.id);",
      "label": "Get current artboard"
    },
    {
      "tool": "find_objects",
      "args": "{ \"artboard_id\": \"{{artboardId}}\", \"query\": \"{{search}}\" }",
      "label": "Find matching objects"
    },
    {
      "tool": "_compute",
      "args": "const objs = JSON.parse(results[3]); const arr = Array.isArray(objs) ? objs : []; const renames = arr.map(o => ({ id: o.id, name: o.name.replace(new RegExp(vars.search, 'g'), vars.replace) })); setVar('renames', renames); setVar('count', String(renames.length));",
      "label": "Build rename list"
    },
    {
      "tool": "rename_objects",
      "args": "{ \"renames\": {{json:renames}} }",
      "label": "Apply renames"
    }
  ]
}
```

### Complete Example: Inspect Artboard

```json
{
  "title": "Inspect Artboard",
  "description": "Report of current artboard contents",
  "icon": "search",
  "category": "utility",
  "tags": ["inspect", "debug"],
  "hasUi": false,
  "steps": [
    {
      "tool": "list_artboards",
      "args": "{}",
      "label": "List artboards"
    },
    {
      "tool": "_compute",
      "args": "const abs = JSON.parse(results[0]); const list = Array.isArray(abs) ? abs : abs.artboards || []; const cur = list.find(a => a.isCurrent) || list[0]; if (!cur) throw new Error('No artboards found'); setVar('artboardId', cur.id); setVar('artboardName', cur.name);",
      "label": "Find current artboard"
    },
    {
      "tool": "get_artboard_hierarchy",
      "args": "{ \"artboard_id\": \"{{artboardId}}\" }",
      "label": "Get hierarchy"
    },
    {
      "tool": "_compute",
      "args": "const hier = JSON.parse(results[2]); let c={total:0,groups:0,shapes:0,bones:0,texts:0,images:0}; function walk(n){c.total++;const t=(n.type||'').toLowerCase();if(t==='group'||t==='node')c.groups++;else if(t==='shape'||t==='rectangle'||t==='ellipse')c.shapes++;else if(t==='bone')c.bones++;else if(t==='text')c.texts++;else if(t==='image')c.images++;if(n.children)n.children.forEach(walk);} walk(hier); setVar('report',vars.artboardName+'\nTotal: '+c.total+'\nGroups: '+c.groups+'\nShapes: '+c.shapes+'\nBones: '+c.bones+'\nTexts: '+c.texts+'\nImages: '+c.images);",
      "label": "Count objects"
    },
    {
      "tool": "animation_editor",
      "args": "{ \"action\": \"list\", \"artboard_id\": \"{{artboardId}}\" }",
      "label": "List animations"
    }
  ]
}
```

---

### Script Icons

Available: `bone`, `artboard`, `search`, `star`, `code`, `layout`, `palette`, `grid`, `layers`, `eye`, `lock`, `unlock`, `settings`, `tool`, `pen`, `brush`, `type`, `image`, `film`, `music`, `folder`, `file`, `save`, `download`, `upload`, `share`, `link`, `globe`, `heart`, `zap`, `rocket`, `coffee`, `award`, `check`, `x`, `alert`, `info`, `plus`, `minus`, `move`, `copy`, `trash`, `edit`, `rotate`, `flip`, `maximize`, `minimize`, `droplet`, `feather`, `compass`

---

### ⚠️ Rive MCP Payload Rules (Critical)

These rules prevent the most common AI failures when scripting for Rive MCP tools.

#### 1. Double-Wrapping for Complex Tools

For `animation_editor`, `viewmodel_editor`, `open_file_editor`, `path_editor`, `layout_editor`, and `component_editor`, arguments MUST be wrapped in a `data` object containing a key matching the command name.

❌ WRONG:
```json
{ "command": "createStates", "layerId": "123", "states": [...] }
```
✅ CORRECT:
```json
{ "command": "createStates", "data": { "createStates": { "layerId": "123", "states": [...] } } }
```

Simple commands (list, query) usually don't need `data` wrapping:
```json
{ "command": "listStateMachines" }
```

#### 2. ID Retrieval: Create Then Query

Creation commands (`createLinearAnimations`, `createStateMachineLayers`, etc.) often return `success: true` with empty arrays for created items.

**Do NOT rely on creation responses for IDs.** Always follow a creation step with a list/query command:
```
Step 1: Create → { "command": "createLinearAnimations", "data": {...} }
Step 2: List   → { "command": "listLinearAnimations" }
Step 3: _compute → find by name to get the ID
```

#### 3. Response Parsing

Rive MCP responses are often **dictionaries keyed by ID**, not simple arrays:
```js
// Response might be: { "abc123": [...], "def456": [...] }
var data = JSON.parse(results[N]);
var firstKey = Object.keys(data)[0];
var items = data[firstKey];
```

Always use `Object.keys()` or `for (var id in data)` to iterate.

#### 4. Property Keys are Numbers

When using `set_property_values` or `query_property_values`, property keys are **integer IDs**, not strings:
```json
{ "object_id": "abc", "properties": { "13": 100, "14": 200 } }
```

Known keys:
- 13: Position X
- 14: Position Y
- 15: Scale X / Width
- 24: Opacity
- 296: Solo / Active Child (State Machines)

Use `query_property_keys` to discover available keys for any object type.

#### 5. Artboard ID is Always Required

Most tools need an `artboard_id`. Always get it first:
```json
{
  "tool": "list_artboards", "args": "{}",
  "extract": { "artboardId": "artboards[?isCurrent].id" }
}
```

---

### Best Practices

1. **Use `extract` on tool steps** to capture values into vars — avoids extra _compute steps
2. **Use `setVar()` in _compute** to store values — `vars.x` also works for reading
3. **Use `results[N]` in _compute** to access raw text from step N — always `JSON.parse()` it
4. **Use `_ui` for user input** — field `key` becomes the variable name directly in `vars`
5. **Use `{{varName}}` in tool args** for strings, `{{json:varName}}` for objects/arrays
6. **Handle errors** — `throw new Error('message')` in _compute stops the script cleanly
7. **Label every step** — makes the script readable and debuggable
8. **Keep steps atomic** — one tool call per step, use _compute for logic
9. **Test incrementally** — use the ▶ button on each step to test one at a time
10. **No `steps[N].result`** — only `vars`, `results`, and `setVar` exist in the engine