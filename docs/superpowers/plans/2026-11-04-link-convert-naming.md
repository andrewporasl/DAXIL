# Name Link Conversions + MP3 Save Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a link is converted straight to a file (MP4, MP3 or GIF), ask for a file name first. MP4 and GIF still save automatically to the Converted links folder. MP3 saves to a folder the user picks, and DAXIL remembers it (for example, Spotify's local files folder).

**Architecture:** The link dialog (`LinkModal`) gets a second step, "Name your file". Clicking **Save as …** opens it, and the link box's **GIF** button opens it directly with GIF selected. The step has a name field and shows the target folder. For MP3 it adds a **Change…** button that saves a new `mp3OutputDir` setting right away. In main, `convert:output-path` picks its folder through one shared pure function, `convertDirFor`. The renderer uses the same function to show that folder, so the two can't disagree. No save dialog is added.

**Tech Stack:** Electron 36, React 19, TypeScript 5, electron-vite, electron-store v8, `node --test` with `--experimental-strip-types`, Electron UI harness `tests/editor-ui.cjs`.

**Spec:** No separate spec. This is the user's request, verbatim:
> MAKE IT SO WHERE WHEN I ADD CLIPS STARIGHT TO FILES FROM MEDIA LINKS, I GET THE PROMPT TO NAME THEM. MAKE MP4 AND GIFS AUTO SAVE TO THE FOLDER IN THE SETTINGS THATS SET FOR IT, BUT WHEN YOU SAVE AS MP3 LET ME CUSTOMIZE WHERE TO SAVE THAT CUS I LIKE SAVING SOUNDCLOUD SONGS TO SPOTIFY.

Interpretation decisions (flag any you disagree with before execution):
- "Customize where to save MP3" means a remembered MP3 folder. It can be changed from the naming step (**Change…**) or in Settings → General → **MP3 folder**. If it is unset, MP3s go to the Converted links folder, which is today's behavior.
- Leaving the name blank is allowed. The file then gets the generic download name (`clip1`, `clip2`, …), as it does today.
- "Add to media pool" is not a file conversion, so it is unchanged. Media pool items can already be renamed.

## Global Constraints

- Existing files are never overwritten. Name clashes keep the `name (2).ext` numbering from `uniqueOutputPath` in `main/output.ts`.
- Typed names are sanitized only by `uniqueOutputPath`, which strips path separators so a name can never point outside the target folder. Do not add a second sanitizer that disagrees with it.
- The MP4/GIF path never opens a dialog. It goes straight to `convertOutputDir`, which defaults to `app.getPath('downloads')`.
- Links that only have sound still become MP3 even if MP4 or GIF was picked (existing `hasVideo` check in `handleLinkConvert`), so they go to the MP3 folder.
- The renderer never sends a folder path to `convert:output-path`. Main reads the folder from the store, so the renderer can't direct writes to an arbitrary path.
- No new dependencies. Plain CSS in `renderer/src/app.css` using the existing variables and classes (`settings-field`, `settings-input-row`, `icon-button`, `btn-primary`, `btn-ghost`).

## Review Focus

1. **A sound-only link with MP4 or GIF picked**: the naming step showed the Converted links folder, but the file becomes an MP3 and lands in the MP3 folder. The name step must say so whenever the folders differ. Pinned in Task 2's UI test (SoundCloud link, MP4 picked → the step mentions the MP3 folder, and the output is in the MP3 folder).
2. **A blank or whitespace-only name**: expected to save as `clipN.ext`, never `.mp3` or ` .mp3`. Pinned in Task 2's UI test (blank name → basename `clipN.gif`).
3. **A name with path characters (`../x`, `a/b`, `con`)**: expected to stay inside the target folder. Already covered by `uniqueOutputPath` tests. Task 1 adds a `convertDirFor` test so the folder choice can't be bypassed.
4. **The MP3 folder setting set to blank in Settings**: expected to fall back to the Converted links folder, not an empty or relative path. Pinned in Task 1's unit test (`'   '` → falls back).
5. **Enter and Escape in the name step**: Enter saves (does not reopen "Add to media pool"), Escape closes the whole dialog without downloading. Pinned in Task 2's UI test.

---

### Task 1: MP3 folder setting and folder resolution

**Files:**
- Create: `shared/convertDir.ts`
- Modify: `shared/types.ts` (`AppSettings`, around line 145)
- Modify: `main/ipc.ts` (`convert:output-path` ~line 107, `settings:get` ~line 168, `settings:set` ~line 180, `storageLocations` ~line 210)
- Modify: `renderer/src/components/SettingsModal.tsx` (General tab, after the "Converted links folder" field; `OUTSIDE_KEYS`)
- Test: `tests/timeline.test.mjs` (next to the existing `uniqueOutputPath` test, ~line 302)

**Interfaces:**
- Produces: `AppSettings.mp3OutputDir?: string`. Empty or missing means "use the Converted links folder".
- Produces: `convertDirFor(mode: ExportMode, dirs: { convertOutputDir?: string; mp3OutputDir?: string }, fallback: string): string` in `shared/convertDir.ts`. Values are trimmed. `'audio'` → `mp3OutputDir || convertOutputDir || fallback`. Anything else → `convertOutputDir || fallback`.
- Produces: `settings:get` returns `mp3OutputDir` (stored value or `''`). `settings:set` with `mp3OutputDir` trims it, and stores it, or deletes it from the store if it is empty.
- Unchanged signature: `convertOutputPath(mode, name)`. Main now resolves the folder with `convertDirFor(mode, { convertOutputDir: s.get('convertOutputDir'), mp3OutputDir: s.get('mp3OutputDir') }, app.getPath('downloads'))`.

- [ ] **Step 1: Write the failing test** in `tests/timeline.test.mjs`

```js
test('MP3 conversions use their own folder, everything else the converted-links folder', async () => {
  const { convertDirFor } = await import('../shared/convertDir.ts')
  const dirs = { convertOutputDir: '/conv', mp3OutputDir: '/spotify' }
  assert.equal(convertDirFor('audio', dirs, '/dl'), '/spotify')
  assert.equal(convertDirFor('video', dirs, '/dl'), '/conv')
  assert.equal(convertDirFor('gif', dirs, '/dl'), '/conv')
  assert.equal(convertDirFor('audio', { convertOutputDir: '/conv', mp3OutputDir: '   ' }, '/dl'), '/conv', 'a blank MP3 folder falls back')
  assert.equal(convertDirFor('audio', {}, '/dl'), '/dl')
  assert.equal(convertDirFor('gif', { mp3OutputDir: '/spotify' }, '/dl'), '/dl', 'the MP3 folder never catches GIFs')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL. Cannot find module `shared/convertDir.ts`.

- [ ] **Step 3: Implement `convertDirFor` in `shared/convertDir.ts`** with the signature above. It is a pure function with no Node imports, because the renderer imports it too. Use the import style `shared/exportPlan.ts` uses for `ExportMode`.

- [ ] **Step 4: Wire main and the type**
  - Add `mp3OutputDir?: string   // where MP3s made straight from a link go; empty = convertOutputDir` to `AppSettings`.
  - `convert:output-path`: replace the inline `dir` expression with `convertDirFor(...)` as shown in Interfaces. Keep `mkdirSync` and `validateOutputPath(uniqueOutputPath(...))`.
  - `settings:get`: add `mp3OutputDir: s.get('mp3OutputDir', '')`.
  - `settings:set`: `if (settings.mp3OutputDir !== undefined) { const dir = settings.mp3OutputDir.trim(); if (dir) s.set('mp3OutputDir', dir); else s.delete('mp3OutputDir') }`.
  - `storageLocations`: add `{ key: 'mp3', label: 'MP3 saves', path: mp3Dir, note: 'MP3s from "Convert and save". Never deleted by DAXIL.', … }` right after `conversions`. Compute `mp3Dir` with `convertDirFor('audio', …)`.

- [ ] **Step 5: Add the Settings field.** In the General tab, after "Converted links folder", add a `settings-field` labelled **MP3 folder**. It has an input bound to `settings.mp3OutputDir ?? ''`, placeholder `Same as converted links folder`, a Browse `icon-button` with `aria-label="Browse MP3 folder"` that calls `openFolderDialog`, and this hint: `Where MP3s from <b>Convert and save</b> go, for example your Spotify local files folder. Leave empty to use the converted links folder.` Add `'mp3'` to `OUTSIDE_KEYS` after `'conversions'`.

- [ ] **Step 6: Verify**

Run: `npm test` → Expected: PASS, including the new test.
Run: `npm run lint` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add shared/convertDir.ts shared/types.ts main/ipc.ts renderer/src/components/SettingsModal.tsx tests/timeline.test.mjs
git commit -m "Add an MP3 folder setting for link conversions"
```

---

### Task 2: "Name your file" step for link conversions

**Files:**
- Modify: `renderer/src/components/LinkModal.tsx`
- Modify: `renderer/src/App.tsx` (`pendingLink` state ~line 99, `handleLinkConvert` ~line 343, `requestLink` ~line 371, LinkBox `onGif` ~line 550, LinkModal render ~line 626)
- Modify: `renderer/src/app.css` (next to the `.link-modal` rules, ~line 1191)
- Modify: `README.md` (Links bullet, line 30)
- Test: `tests/editor-ui.cjs` (IPC mocks ~lines 42–47; link section ~lines 340–401)

**Interfaces:**
- Consumes: `convertDirFor` from `@shared/convertDir`, `AppSettings.mp3OutputDir`, and `window.electronAPI.getSettings / saveSettings / openFolderDialog` (all existing).
- Produces: `LinkModal` props become `{ url: string; defaultFormat: ExportMode; quick?: ExportMode; onPool: () => void; onConvert: (mode: ExportMode, name: string) => void; onClose: () => void }`. If `quick` is set, the dialog opens on the name step with that format.
- Produces: `pendingLink` state becomes `{ url: string; quick?: ExportMode } | null`. `requestLink(url: string, quick?: ExportMode)`.
- Produces: `handleLinkConvert(url: string, requested: ExportMode, name: string)`. `baseName` is `name.trim()` if it isn't blank, otherwise the existing `result.title` fallback chain.
- DOM hooks the test relies on: `.link-name-step` (the step container, a `<form>`), `.link-name-input`, `.link-name-folder` (shows the target folder path), `.link-name-change` (MP3 only: **Change…**), `.link-name-save` (submit), `.link-name-back`.

- [ ] **Step 1: Update the UI test mocks** in `tests/editor-ui.cjs`
  - Keep a mutable `let settingsState = { defaultOutputDir: work, convertOutputDir: path.join(work, 'converted'), mp3OutputDir: '', ffmpegPath: 'auto', ffprobePath: 'auto', ytDlpPath: 'auto' }`. Have `settings:get` return `{ ...settingsState }`, and add `settings:set` with `(_, patch) => { settingsState = { ...settingsState, ...patch } }`.
  - Add `ipcMain.handle('dialog:open-folder', () => path.join(work, 'music'))`.
  - `convert:output-path` mock: `(_, mode, name) => path.join(mode === 'audio' && settingsState.mp3OutputDir ? settingsState.mp3OutputDir : path.join(work, 'converted'), `${name}${ext}`)`.

- [ ] **Step 2: Write the failing assertions** in the link section. Replace the quick-GIF block and the MP3 convert block:

```js
// Quick GIF: the name step opens straight away; a blank name keeps the generic download name.
await setInput('.link-box-input', 'https://youtu.be/abc')
await click('.link-box-gif')
await waitFor(() => js('Boolean(document.querySelector(".link-name-step"))'), 'GIF did not ask for a name')
assert.equal(await js('document.activeElement === document.querySelector(".link-name-input")'), true, 'the name field is focused')
assert.ok((await js('document.querySelector(".link-name-folder").textContent')).includes(path.join(work, 'converted')), 'GIFs show the converted-links folder')
assert.equal(await count('.link-name-change'), 0, 'GIF folders are not chosen here')
assert.equal(exported, null, 'nothing is downloaded before the name is confirmed')
await click('.link-name-save')
await waitFor(() => exported, 'Quick GIF export was not requested')
assert.equal(path.basename(exported.outputPath), 'clip2.gif', 'a blank name keeps the generic name')
// …existing mode / clips / timeline assertions stay…

// Convert to MP4 with a name: auto-saves to the converted-links folder under that name.
exported = null
await setInput('.link-box-input', 'https://youtu.be/named')
await click('.link-box-add')
await waitFor(() => js('Boolean(document.querySelector(".link-modal"))'), 'the link dialog did not open')
await js(`document.querySelector('.link-choice-go').click()`)          // MP4 is the default format
await waitFor(() => js('Boolean(document.querySelector(".link-name-step"))'), 'Save as did not ask for a name')
await setInput('.link-name-input', 'funny cat')
await js(`document.querySelector('.link-name-input').form.requestSubmit()`)   // Enter submits
await waitFor(() => exported, 'named MP4 was not requested')
assert.equal(exported.outputPath, path.join(work, 'converted', 'funny cat.mp4'))

// Escape on the name step closes the dialog without downloading.
exported = null
await setInput('.link-box-input', 'https://soundcloud.com/someone/other')
await click('.link-box-add')
await waitFor(() => js('Boolean(document.querySelector(".link-modal"))'), 'the link dialog did not open')
await js(`document.querySelector('.link-choice-go').click()`)
await waitFor(() => js('Boolean(document.querySelector(".link-name-step"))'), 'no name step')
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await waitFor(() => js('!document.querySelector(".link-modal")'), 'Escape did not close the name step')
assert.equal(exported, null)

// MP3: choose a folder (remembered), name it, save there.
await setInput('.link-box-input', 'https://soundcloud.com/someone/other')
await click('.link-box-add')
await waitFor(() => js('Boolean(document.querySelector(".link-modal"))'), 'the link dialog did not reopen')
await js(`Array.from(document.querySelectorAll('[aria-label="Convert to"] button')).find(b => b.textContent === 'MP3').click()`)
await js(`document.querySelector('.link-choice-go').click()`)
await waitFor(() => js('Boolean(document.querySelector(".link-name-change"))'), 'MP3 offers no folder choice')
await click('.link-name-change')
await waitFor(() => settingsState.mp3OutputDir === path.join(work, 'music'), 'the MP3 folder was not remembered')
await waitFor(async () => (await js('document.querySelector(".link-name-folder").textContent')).includes(path.join(work, 'music')), 'the new folder is not shown')
await setInput('.link-name-input', 'my song')
await click('.link-name-save')
await waitFor(() => exported, 'convert to MP3 was not requested')
assert.equal(exported.mode, 'audio')
assert.equal(exported.outputPath, path.join(work, 'music', 'my song.mp3'))
assert.equal((await ranges()).length, timelineBefore, 'converting does not touch the timeline')
```

Placement: the quick-GIF block replaces the existing quick-GIF block in place, before the cleanup-prompt section. It is the second download, so the name is `clip2.gif`. The MP4, Escape and MP3 blocks replace the old "Convert and save: straight to MP3" block, after the "Removing a download" section and after `timelineBefore` is captured. That way the cleanup-prompt counts (`Delete 2 downloaded clips`, `discarded.length === 2`) and `Remove clip3 from pool` stay unchanged.

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:ui`
Expected: FAIL with `GIF did not ask for a name`.

- [ ] **Step 4: Implement the name step in `LinkModal.tsx`**
  - State: `step: 'choose' | 'name'` (starts as `'name'` if `quick` is set), `format` (starts as `quick ?? defaultFormat`), `name: string`, and `dirs: Pick<AppSettings, 'convertOutputDir' | 'mp3OutputDir'>`, loaded once with `getSettings()`.
  - "Save as X" sets `step = 'name'` (it no longer calls `onConvert`).
  - Name step: a `<form className="link-name-step" onSubmit={e => { e.preventDefault(); onConvert(format, name) }}>` containing:
    - A title: `Name your {LABEL}`.
    - An `<input className="link-name-input" autoFocus placeholder="clip" maxLength={120} aria-label="File name">`, with the extension shown as a suffix next to the input.
    - A `.link-name-folder` row: `Saves to <path>`, where path is `convertDirFor(format, dirs, '')` or `Your Downloads folder` if that is empty.
    - For `format === 'audio'` only, a `.link-name-change` `btn-ghost` **Change…** button. It calls `openFolderDialog()`. On a result it calls `saveSettings({ mp3OutputDir: dir })` and updates `dirs`.
    - For `format !== 'audio'`, a one-line hint: `If this link only has sound, it's saved as an MP3 to <mp3 folder>.` Show it only when `convertDirFor('audio', dirs, '') !== convertDirFor(format, dirs, '')` (Review Focus 1).
    - Footer: `.link-name-back` **Back** (`btn-ghost`; goes back to `'choose'`, or calls `onClose` when opened via `quick`) and `.link-name-save` **Save** (`btn-primary`, `type="submit"`).
  - Escape still calls `onClose` from either step. Remove the `poolButton` autofocus effect while on the name step so focus stays on the input.
  - Footer text: `The downloaded original is temporary. MP4 and GIF go to your Converted links folder; MP3s go to your MP3 folder. Both are set in Settings.`

- [ ] **Step 5: Wire `App.tsx`**
  - `pendingLink` becomes `{ url, quick? } | null`. `requestLink(url, quick?)` sets it under the same `downloading` / `exportState` guard.
  - LinkBox `onGif={url => requestLink(url, 'gif')}` (no longer calls `handleLinkConvert` directly).
  - `<LinkModal url={pendingLink.url} quick={pendingLink.quick} … onConvert={(mode, name) => { const { url } = pendingLink; setPendingLink(null); void handleLinkConvert(url, mode, name) }} />`.
  - In `handleLinkConvert`, add a `name` parameter and change `baseName` to `(name.trim() || result.title || meta.fileName.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'clip'`. Leave everything else in it unchanged.

- [ ] **Step 6: Style it** in `app.css`, next to `.link-modal`. Lay out `.link-name-step` as a padded column (16px, gap 12px), give the input row an inline extension suffix, make `.link-name-folder` dim 12px text that truncates with an ellipsis and has a `title` holding the full path, and right-align the footer buttons. Reuse the existing variables only.

- [ ] **Step 7: Update the README.** In the Links bullet (line 30), replace "convert and save it straight to MP4, MP3 or GIF in its own folder (set in Settings)" with "convert and save it straight to MP4, MP3 or GIF. You name the file; MP4 and GIF go to the Converted links folder, MP3s to an MP3 folder you choose (handy for Spotify local files)."

- [ ] **Step 8: Verify**

Run: `npm run lint` → Expected: no errors.
Run: `npm test` → Expected: PASS.
Run: `npm run test:ui` → Expected: ends with the `UI PASS: …` line. Append `link naming, MP3 folder` to that summary string.

- [ ] **Step 9: Commit**

```bash
git add renderer/src/components/LinkModal.tsx renderer/src/App.tsx renderer/src/app.css README.md tests/editor-ui.cjs
git commit -m "Ask for a file name when converting a link; MP3s save to a chosen folder"
```

---

### Task 3: Conversions never touch the media pool

Added after the plan was approved. The user's words: "when i do the link can you not add it to the media pool, like if i do download it quick, like id click add to media pool if i wanted that."

**Files:**
- Modify: `renderer/src/App.tsx` (`handleLinkConvert`)
- Modify: `renderer/src/components/LinkModal.tsx` (convert-card copy only)
- Test: `tests/editor-ui.cjs` (quick-GIF block and cleanup-prompt block)

**Interfaces:**
- Consumes: `handleLinkConvert(url, requested, name)` from Task 2, and `window.electronAPI.discardDownloads(filePaths: string[])` (existing).
- Produces: after any link conversion (success, failure, or declining the long-GIF confirm), the downloaded original is passed to `discardDownloads([result.filePath])` and is never added to `media`.

- [ ] **Step 1: Write the failing assertions.** In the quick-GIF block, after `exported` arrives:

```js
assert.ok(!(await js('Array.from(document.querySelectorAll(".media-asset"), a => a.textContent).join()')).includes('clip2'), 'a conversion does not land in the media pool')
await waitFor(() => discarded.some(file => file.endsWith('download2.mp4')), 'the converted download was not deleted')
```

In the cleanup-prompt block, the pool now holds one download (`download1` from "Add to media pool"), so expect `'Delete 1 downloaded clip'` (singular, as `ResultPanel` writes it) and `discarded.length === 2` (`download2` from the conversion plus `download1` from Delete). Also assert that `poolWithDownloads - 1` assets remain. In the MP3 block, add the same "not in the pool" check for the new clip's name.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:ui`
Expected: FAIL with `a conversion does not land in the media pool`.

- [ ] **Step 3: Implement.** In `handleLinkConvert`, keep building the local `asset` (the encode needs it) but drop the `setMedia(...)` call. Wrap everything after the download in `try { … } finally { void window.electronAPI.discardDownloads([result.filePath]) }`. Keep the existing `catch` that sets the export error. Change the convert card's copy to `Download it and save it straight to a file. Nothing is added to your project.`

- [ ] **Step 4: Verify**

Run: `npm run lint` → no errors. `npm test` → PASS. `npm run test:ui` → `UI PASS: …`.

- [ ] **Step 5: Commit**

```bash
git add renderer/src/App.tsx renderer/src/components/LinkModal.tsx tests/editor-ui.cjs
git commit -m "Link conversions skip the media pool and delete their download"
```
