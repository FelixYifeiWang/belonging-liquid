# Belonging – Kinship Visualization (Final)

An interactive canvas for exploring cultures as living geometries. Each culture is a polygon whose edges, particles, and motion encode relationships and practices. Built as a single React component (`final.tsx`) with no external UI framework required.

---

## Quick Start

1. **Create a React app** (Vite or CRA both fine) and copy `final.tsx` into your project. Export it and render in your page.
2. **Install dependency:**

   ```bash
   npm i papaparse
   ```
3. **Place your data:** put `final.csv` in your app’s **public/** folder (or provide a file via the in‑app uploader).
4. **Run:** `npm run dev` (or your framework’s dev script). The visualization autoloads `final.csv` on mount.

---

## CSV Schema (required columns)

| Column                    | Type                   | Notes                                                                                      |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| **Name**                  | string                 | Unique culture/circle name.                                                                |
| **Kinships**              | comma‑separated string | Peer relations. Use exact names from **Name** for clean linking.                           |
| **Affiliation**           | comma‑separated string | Hierarchical parent(s). Must be at **higher scope** than child.                            |
| **Knowledgebase**         | int (1‑10)             | ≤6 renders morphing (dynamic); >6 renders rigid/static.                                    |
| **Openness**              | int (1‑10)             | Encoded in border style (see Visual Encoding).                                             |
| **Language**              | int (1‑5)              | Scales particle size subtly.                                                               |
| **Sides**                 | int (≥3)               | Polygon sides (also used for spacing/size scaling).                                        |
| **InteriorParticleCount** | int                    | Precomputed interior particle count.                                                       |
| **ParticlesPerEdge**      | int                    | Precomputed border particle density per edge. Total border particles = sides × this value. |
| **Color**                 | hex                    | Polygon/particle base color (e.g. `#FF6B6B`).                                              |
| **Scope**                 | enum                   | `family`, `local`, `regional`, `national`, `global` (used for filters and validation).     |

> **Tip**: If you prefer not to precompute particle counts, you can approximate them offline with any processor, but this component expects the two particle columns to already be present for best performance.

---

## Visual Encoding (Final Code)

### Shapes & Layout

* **Culture = polygon** with `Sides ≥ 3`.
* **Base radius**: `150 + (Sides - 3) * 20` (more sides → larger polygon).
* **Initial placement** uses jitter + spacing; soft force keeps clusters readable.

### Color

* **Base color** from CSV `Color` (HEX→HSL under the hood).
* **Particles** sample culture hue with subtle sat/light jitter for variation.

### Particles — Counts & Types

* **Interior particles**: read from CSV `InteriorParticleCount` (precomputed; clamped to a sane minimum).
* **Border particles**: read from CSV `ParticlesPerEdge`; **total border particles** = `ParticlesPerEdge × Sides`.
* **Placement**: interior points are inside the polygon; border points sit along edges at even intervals.

### Particle Size (Radius)

* **Encodes `Language` (1–5)**: `radius = (Language × 0.6) + random(0–2)` — higher language score → larger dots (with jitter).

### Motion & Behavior

* **Interior**: gentle random walk with damping; soft polygon boundary repels to keep points inside.
* **Border**: in *Borderless* mode, edge dots gently drift/wave; in *Default* mode, they are not rendered to save work.

### Borders (Two Modes)

* **Default mode** (stroke-drawn polygon) — **Openness encodes stroke style**:

  * `openness ≥ 7`: thin dashed, line width ~**1.5**
  * `4 ≤ openness < 7`: semi‑dashed, line width ~**2**
  * `openness < 4`: solid, line width ~**3**
* **Borderless mode**: no stroke; **edge dots** render the boundary (dot radius ≈ **2.5px**; count from `ParticlesPerEdge × Sides`).

### Opacity / Emphasis

* **Base opacity** ~**0.5**.
* **Hover/Focus** raises to **1.0**; focused + kin cultures also scale via `targetScale/targetOpacity`.

### Morphing (Shape Dynamics)

* **Knowledgebase ≤ 6** → polygon vertices “breathe” (sinusoidal radius); **> 6** → rigid/static.

### Labels

* Culture **names** render on visibility/hover; increase in size when focused (up to ~**22px** in the top layer).

### Kinship Focus & Color Exchange

* Clicking a culture centers it; **kin cultures** arrange around it with aligned edges.
* **Particle flow**: ≈ **50%** of the focused culture’s interior particles travel to kin over broad paths; ≈ **20%** of those perform a **color swap** with kin and keep the new hue on return (distributed across connections). Border particles do not participate.

### Scope & Hierarchies

* **Scope** (`family/local/regional/national/global`) is used for filtering and parent–child validation.
* **Affiliation** places a child inside a higher‑scope parent; siblings inside a parent don’t repel each other, preventing jitter.

## Interactions & Modes

### Global Navigation

* **Pan:** drag background.
* **Zoom:** trackpad/pinch or browser zoom; the camera auto‑centers after some actions.
* **Search:** type to filter cultures by name; click a result to smoothly center the camera.
* **Scope filter:** toggle `all / family / local / regional / national / global`.
* **Mode toggle:** press **B**/**D** to switch between **Default** (border‑drawn) and **Borderless** (border made of particles) modes.

### Focus Mode (click a culture)

* Focused culture grows and centers; **kin cultures** arrange around it with edges aligned.
* **Particles flow** along wide, organic paths between the focused culture and its kin. A subset **swaps color** to encode knowledge exchange. Leaving focus **returns** particles home before the layout resets.
* **Exit focus:** click the background while the details panel is open.

### Hover

* Hovering boosts a culture’s opacity (spotlight‑like feedback) without entering focus mode.

---

## Panels & Feedback

* **Culture details panel** slides in/out with gradient feedback and staged text fades.
* **Search dropdown** and subtle hover highlights improve discoverability.

---

## Hierarchies (Affiliations)

* Use **Affiliation** to place a culture **inside** a higher‑scope parent.
* Parent/child collisions are disabled to prevent jitter; siblings under the same parent don’t repel each other inside the parent’s boundary.
* Invalid parent references are ignored (e.g., missing names or non‑higher scopes).

---

## Physics & Rendering Notes

* Force‑directed drift with home springs, gentle Brownian motion, collision‑avoidance, and soft polygon boundaries (interior edge repel + velocity dampening) keep motion natural and readable.
* Particle flows use steering + perpendicular dispersion (diffusion‑like) for broad, expressive paths that remain legible at distance.

---

## Performance

* Large worlds (12k × 9k). Precomputing particle counts in CSV avoids runtime spikes. Border particles are simulated only in *Borderless* mode; in *Default* mode they’re skipped to save work.

---

## Troubleshooting

* **I see a console warning about `final.csv`.**  Ensure `public/final.csv` exists (or upload via the UI).
* **Kinships aren’t linking.**  Ensure **exact string matches** with `Name` values (avoid plurals/suffixes).
* **Parents aren’t applied.**  The parent must be present in CSV and at a **higher scope** (`global > national > regional > local > family`).

---

## Roadmap / Notes

* Curate mode primitives exist (activity particles & rotating shape) but are hidden from the default UI and considered experimental.
* Consider spatial partitioning/clustering if you push to very large datasets (1000+ cultures).

---