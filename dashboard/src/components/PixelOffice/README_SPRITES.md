# PixelOffice sprites

The canvas draws programmatic 16x16 placeholder characters by default. To
upgrade to real art (e.g. **JIK-A-4 Metro City Free Topdown Character Pack** —
https://jik-a-4.itch.io/metrocity-free-topdown-character-pack, CC0):

1. Download the character pack and open any `.png` spritesheet.
2. Crop/export each character as a **4x4 grid of 16x16 frames** (64x64 PNG).
   Rows = direction (down, left, right, up). Columns = walk frames 0..3.
3. Save as `sprites/<agentId>.png` using these filenames:
   `scout.png`, `helena.png`, `angela.png`, `sam.png`, `kai.png`,
   `carlos.png`, `davinci.png`, `verifier.png`, `manager.png`.
4. Vite will hash them via `new URL('./sprites/...', import.meta.url)` — just
   save and HMR picks them up; no code changes required.
5. If a file is missing the component silently falls back to the colored
   placeholder for that agent.

No other assets are required. Walls/desks/floor are drawn procedurally to a
cached offscreen canvas.
