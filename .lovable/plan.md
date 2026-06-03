## Goal

Make the main menu screen use the user's image **only as a background**, and render every UI element (currency, play, shop tabs, bottom row) as real, clickable React components — not invisible hotspots over an image.

## Changes (all in `src/routes/index.tsx`, `state === "menu"` block, ~lines 2043–2082)

### 1. Background
- Keep `menuBgAsset` import.
- Render the image as a true background: `absolute inset-0 w-full h-full object-cover` with `pointer-events-none`, behind everything (no aspect-ratio container, no hotspots on top).

### 2. Top-right currency (coins only — remove gems)
- Small pill: 🪙 + `{wallet}` (no `+` button, no gems).
- Positioned `top-3 right-3`.

### 3. Title
- "SPACE RUSH" text with gradient (cyan → purple → pink), uppercase, large, centered near the top.

### 4. PLAY button (center)
- Large gradient button (orange → pink → purple), rounded-full, big shadow.
- `onClick={start}`, hover scale-105, active scale-95.

### 5. Bottom shop row (4 buttons)
- Grid of 4 styled cards with icon + label, purple border, dark translucent bg:
  - 👤 Скины → `setShopTab("skins")`
  - 🗺️ Карты → `setShopTab("maps")`
  - 🚀 Транспорт → `setShopTab("vehicles")`
  - 📋 Задания → `setQuestsOpen(true)`

### 6. Below-shop row (3 NEW buttons: Statistics, Settings, Leave)
- Smaller pill row centered under the shop grid:
  - 📊 Статистика — opens a simple stats panel (or toast for now if no panel exists; will check existing state for a stats overlay and reuse it; otherwise add a minimal `statsOpen` state + overlay showing best score, total coins, runs).
  - ⚙️ Настройки — toggles a settings panel with the existing mute toggle moved inside (sound on/off).
  - 🚪 Выйти — calls `supabase.auth.signOut()` if logged in, otherwise navigates to `/auth`.

### 7. Cleanup
- Remove all invisible hotspot `<button>`s.
- Remove the standalone mute button at `bottom-3 right-3` (folded into Settings).
- Remove the gem-related top-bar elements still in the image-only flow.

## Styling
- All colors via Tailwind utility classes consistent with current dark space theme (purple/cyan accents, white text, translucent black panels with `backdrop-blur-sm`).
- Buttons: `transition-transform hover:scale-105 active:scale-95`, focus rings.
- Fully responsive — use `clamp`/responsive sizes so layout works at 1055×814 and on mobile.

## Out of scope
- Game logic, shop logic, quests logic — untouched.
- No backend changes.
