#!/usr/bin/env python3
"""
CSV → normalized + scope/kinship/affiliation + energy-driven particle counts for the Kinship Data-Viz.

LLM (GPT-5 via Responses API):
  - Names     : normalize to 1–3 Title-Cased words, ignore [AI Submission].
  - Scopes    : decide from THREE fields (declared scope, values/traits, own words) → (scope, confidence),
                then lightly rebalance distribution when confidence is low.
  - Actions   : extract monthly action magnitudes + oppCost; MUST estimate (never all zeros).
  - Kin/Affil : detect {Affiliation: 0..1} and {Kinships: 3..10} using Appadurai “scapes”.
                Uses only known culture names; never invents. Parent must be higher scope (at least one tier above the child).

Action schema (monthly):
  hours_direct, hours_organizing, dollars_donated, advocacy_outputs,
  recruitment_count, learning_hours

Energy:
  e_i = Σ_a w_a * action_{i,a} * (1 + λ * oppCost_{i,a}), λ∈[0,1]

Particles:
  - interior from normalized energy
  - border from openness & sides (+ small energy boost)
  - ENFORCE TotalParticleCount ≥ 50

Output CSV:
  Name, Kinships, Affiliation, Knowledgebase, Openness, Scope,
  Sides, InteriorParticleCount, ParticlesPerEdge, BorderParticleCount, TotalParticleCount, Color

Usage:
  python dataprocessing.py --in testdata.csv --out data_processed.csv
"""
from __future__ import annotations

import argparse, hashlib, json, math, os, re, sys, time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import pandas as pd

# ------------------------------- Logging -----------------------------------
def log(msg: str) -> None:
    print(msg, file=sys.stdout, flush=True)

def _fmt_secs(seconds: int) -> str:
    m, s = divmod(int(seconds), 60); h, m = divmod(m, 60)
    if h: return f"{h}h{m:02d}m{s:02d}s"
    if m: return f"{m}m{s:02d}s"
    return f"{s}s"

def log_progress(prefix: str, processed: int, total: int, start_ts: float) -> None:
    pct = (processed/total*100) if total else 100.0
    elapsed = time.time() - start_ts
    eta = None
    if processed > 0 and total > 0:
        rate = elapsed / processed
        eta = max(0, int(rate * (total - processed)))
    eta_str = f" | ETA {_fmt_secs(eta)}" if eta is not None else ""
    log(f"{prefix} {processed}/{total} ({pct:5.1f}%) | elapsed {_fmt_secs(elapsed)}{eta_str}")

# ------------------------------- Constants ---------------------------------
STOP_WORDS = {"the","of","and","a","an","to","in","for","on","at","by","with","from",
              "culture","group","community","society","people"}

ALIASES: Dict[str, List[str]] = {
    "name": ["name","culture","group","label","title"],
    "values": ["values","traits","keywords","features","values & traits"],
    "kinships": ["kinships","peers","relations","kin","links"],
    "knowledgebase": ["knowledgebase","knowledge","familiarity","knowledge_base","kb"],
    "openness": ["openness","openess","openness(1-10)","openness_1_10"],
    "scope": ["scope","level","scale","size","scope of your culture"],
    "practices": ["practices","practice","frequency","cadence","rituals","notes","description"],
    # We'll reuse "affiliations" alias to grab "Your Own Words"
    "affiliations": ["affiliations","parents","hierarchy","affiliation","your own words","own words","umbrella"],
}
# positional fallbacks (0-based index into df columns)
POSITIONAL_FALLBACK = {"name":1,"values":2,"kinships":4,"knowledgebase":5,"openness":6,"scope":8,"practices":9,"affiliations":10}

SCOPE_MAP_4 = {
    "global":"global","international":"global","world":"global","worldwide":"global",
    "national":"national","country":"national","nationwide":"national",
    "state":"regional","regional":"regional","province":"regional","district":"regional",
    "city":"local","local":"local","neighborhood":"local","community":"local","family":"local","household":"local",
}
SCOPE_LEVEL = {"local": 0, "regional": 1, "national": 2, "global": 3}

NEGATION_TOKENS = [
    "no ", " none", " not ", "never", "did not", "didn't", "does not", "doesn't",
    "without", "none noted", "nothing", "zero"
]

# ------------------------------ Small utils --------------------------------
def stable_hash_int(s: str) -> int:
    return int(hashlib.md5((s or "").encode("utf-8")).hexdigest(), 16)

def clean_culture_name_rule_based(s: str) -> str:
    if not isinstance(s,str): return ""
    s = re.sub(r"\[[^\]]*\]"," ",s)
    s = re.sub(r"[^\w\s]"," ",s.strip().lower())
    tokens = [t for t in re.split(r"\s+", s) if t and t not in STOP_WORDS][:3]
    return " ".join(w.capitalize() for w in tokens)

def normalize_list_field(s: str, *, clean_names: bool=False) -> str:
    if not isinstance(s,str): return ""
    parts = [p.strip() for p in re.split(r"[;,]", s) if p.strip()]
    if clean_names:
        parts = [clean_culture_name_rule_based(p) for p in parts if p]
    out, seen = [], set()
    for p in parts:
        if p and p not in seen:
            out.append(p); seen.add(p)
    return ", ".join(out)

def split_list_field(s: str) -> List[str]:
    if not isinstance(s,str) or not s.strip(): return []
    return [p.strip() for p in re.split(r"[;,]", s) if p.strip()]

def parse_int_1_10(x, default=5) -> int:
    try:
        v = int(float(x));  return v if 1 <= v <= 10 else default
    except Exception:
        return default

def normalize_scope_rule_based_4(s: str) -> str:
    if not isinstance(s,str): return "local"
    s_low = s.strip().lower()
    for k,v in SCOPE_MAP_4.items():
        if re.search(rf"\b{k}\b", s_low): return v
    if "global" in s_low or "inter" in s_low or "world" in s_low: return "global"
    if "nation" in s_low or "country" in s_low or "national" in s_low: return "national"
    if "region" in s_low or "state" in s_low or "province" in s_low or "district" in s_low: return "regional"
    return "local"

def pick_series(df: pd.DataFrame, key: str, override_header: Optional[str]) -> pd.Series:
    if override_header:
        for col in df.columns:
            if str(col).strip().lower() == override_header.strip().lower():
                return df[col]
    for alias in ALIASES[key]:
        for col in df.columns:
            if str(col).strip().lower() == alias:
                return df[col]
    idx = POSITIONAL_FALLBACK[key]
    return df.iloc[:, idx] if idx < len(df.columns) else pd.Series([""]*len(df), index=df.index)

# ---- OKLCH color utilities (deterministic + perceptual) --------------------
def oklch_to_oklab(L: float, C: float, h_deg: float) -> Tuple[float, float, float]:
    h = math.radians(h_deg % 360.0)
    a = C * math.cos(h)
    b = C * math.sin(h)
    return (L, a, b)

def oklab_to_linear_srgb(L: float, a: float, b: float) -> Tuple[float, float, float]:
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l = l_ ** 3
    m = m_ ** 3
    s = s_ ** 3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return (r, g, b)

def linear_to_srgb(c: float) -> float:
    if c <= 0.0031308:
        return 12.92 * c
    return 1.055 * (c ** (1/2.4)) - 0.055

def srgb_to_hex(r: float, g: float, b: float) -> str:
    R = int(max(0, min(1, linear_to_srgb(r))) * 255 + 0.5)
    G = int(max(0, min(1, linear_to_srgb(g))) * 255 + 0.5)
    B = int(max(0, min(1, linear_to_srgb(b))) * 255 + 0.5)
    return f"#{R:02X}{G:02X}{B:02X}"

def oklch_to_hex(L: float, C: float, h_deg: float) -> Tuple[str, Tuple[float, float, float]]:
    L = max(0.0, min(1.0, L))
    C = max(0.0, max(0.0, C))
    L_, a_, b_ = oklch_to_oklab(L, C, h_deg)
    r, g, b = oklab_to_linear_srgb(L_, a_, b_)
    return srgb_to_hex(r, g, b), (L_, a_, b_)

def oklab_deltaE(p: Tuple[float, float, float], q: Tuple[float, float, float]) -> float:
    return ((p[0]-q[0])**2 + (p[1]-q[1])**2 + (p[2]-q[2])**2) ** 0.5

# ---- Traits → Color (radically distinct via anchors) -----------------------
ANCHOR_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]  # 12-way, full wheel
ANCHOR_LIGHTNESS = [0.72, 0.60, 0.82, 0.52]  # alternate to increase separation

def assign_colors_divergent(names: List[str],
                            traits: List[Tuple[float, float, float]],
                            deltaE_min: float = 0.22,
                            max_iter: int = 8) -> List[str]:
    assert len(names) == len(traits)
    n = len(names)
    idx = [stable_hash_int(nm) % len(ANCHOR_HUES) for nm in names]
    colors_hex, labs, params = [], [], []
    for i, (nm, (w, e, f)) in enumerate(zip(names, traits)):
        anchor_h = float(ANCHOR_HUES[idx[i]])
        h = (anchor_h + (w - 0.5) * 16.0) % 360.0
        C = 0.18 + min(0.06, max(0.0, e) * 0.06)     # 0.18–0.24
        Lbase = ANCHOR_LIGHTNESS[i % len(ANCHOR_LIGHTNESS)]
        L = max(0.40, min(0.88, Lbase - 0.10 * (f - 0.5)))
        hex_, lab = oklch_to_hex(L, C, h)
        colors_hex.append(hex_); labs.append(lab); params.append((L, C, h))
    GA = 137.50776405003785
    for _ in range(max_iter):
        changed = False
        for i in range(n):
            for j in range(i+1, n):
                if oklab_deltaE(labs[i], labs[j]) < deltaE_min:
                    loser = i if traits[i][1] <= traits[j][1] else j
                    L0, C0, h0 = params[loser]
                    jitter_steps = ((stable_hash_int(names[loser]) % 9) + 2) * 0.18  # 0.36..1.80 of GA
                    h1 = (h0 + GA * jitter_steps) % 360.0
                    hex1, lab1 = oklch_to_hex(L0, C0, h1)
                    params[loser] = (L0, C0, h1)
                    colors_hex[loser] = hex1
                    labs[loser] = lab1
                    changed = True
        if not changed:
            break
    for i in range(n):
        for j in range(i+1, n):
            if oklab_deltaE(labs[i], labs[j]) < deltaE_min:
                L0, C0, h0 = params[j]
                C1 = min(0.28, C0 + 0.03)
                hex1, lab1 = oklch_to_hex(L0, C1, h0)
                params[j] = (L0, C1, h0)
                colors_hex[j] = hex1
                labs[j] = lab1
    return colors_hex

# ---------------------------- LLM base wiring ------------------------------
@dataclass
class LLMBaseConfig:
    model: str = "gpt-5"
    batch_size: int = 8          # conservative to avoid overflow

class _OpenAIHandle:
    def __init__(self):
        key = os.getenv("OPENAI_API_KEY")
        if not key: raise RuntimeError("Set OPENAI_API_KEY.")
        try:
            from openai import OpenAI  # type: ignore
        except Exception as e:
            raise RuntimeError("Install openai>=1.0: pip install openai") from e
        self.client = OpenAI()

    @staticmethod
    def parse_text(resp) -> str:
        text = getattr(resp, "output_text", None)
        if isinstance(text,str): return text
        parts = getattr(resp,"output",None)
        if isinstance(parts,list):
            buf=[]
            for p in parts:
                content=getattr(p,"content",None)
                if isinstance(content,list):
                    for c in content:
                        t=getattr(c,"text",None)
                        if isinstance(t,str): buf.append(t)
            if buf: return "".join(buf)
        return str(resp)

# ------------------------------- LLM: Names --------------------------------
class LLMNames:
    def __init__(self, cfg: LLMBaseConfig, h: _OpenAIHandle):
        self.cfg, self.h = cfg, h

    @staticmethod
    def _preclean(s: str) -> str:
        s = re.sub(r"\[[^\]]*\]"," ",s or "")
        return re.sub(r"\s+"," ",s).strip()

    def normalize(self, raw: List[str]) -> List[str]:
        if not raw: return []
        pre = [self._preclean(x) for x in raw]
        system = {"role":"system","content":
            "Normalize culture names. For each input, return a Title Cased name of 1–3 words. "
            "Strip bracketed tags like [AI Submission]. Return ONLY JSON: {\"names\": [..]} matching input length."}
        user = {"role":"user","content": json.dumps({"input": pre}, ensure_ascii=False)}
        resp = self.h.client.responses.create(model=self.cfg.model, input=[system, user],
                                              text={"verbosity":"low"})
        text = self.h.parse_text(resp)
        try:
            out = json.loads(text).get("names", [])
        except Exception as e:
            raise RuntimeError(f"Name JSON parse failed: {text[:300]}") from e
        out2=[]
        for i,raw_i in enumerate(pre):
            cand = out[i] if i < len(out) else ""
            if isinstance(cand,str):
                w=[w for w in re.split(r"\s+",cand.strip()) if w]
                if 1<=len(w)<=3:
                    out2.append(" ".join(x.capitalize() for x in w)); continue
            out2.append(clean_culture_name_rule_based(raw_i) or f"Culture {i+1}")
        return out2

# ------------------------------- LLM: Scopes -------------------------------
class LLMScopes:
    FEW_SHOTS = [
        ("Operates in multiple countries; international federation; cross-border members.", "global"),
        ("Nationwide program, federal policy, across the country.", "national"),
        ("State or provincial chapter; district-level network.", "regional"),
        ("City-wide meetup; neighborhood association; family/household practice.", "local"),
    ]
    def __init__(self, cfg: LLMBaseConfig, h: _OpenAIHandle):
        self.cfg, self.h, self.cache = cfg, h, {}

    @staticmethod
    def _key(text: str) -> str:
        t = (text or "").lower()
        t = re.sub(r"\[[^\]]*\]", " ", t)
        t = re.sub(r"[^\w\s]", " ", t)
        return re.sub(r"\s+", " ", t).strip()

    def decide(self, evidences: List[str]) -> Tuple[List[str], List[float]]:
        to_q, idxs = [], []
        for i, ev in enumerate(evidences):
            k = self._key(ev)
            if k not in self.cache:
                to_q.append(ev or ""); idxs.append(i)

        if to_q:
            system = {"role":"system","content":
                "Classify each culture's scope using ALL provided evidence.\n"
                "Return ONLY JSON: {\"items\":[{\"scope\":\"global|national|regional|local\",\"confidence\":0..1}, ...]}\n"
                "Rules:\n"
                "- global: multi-country/international/worldwide\n"
                "- national: whole country/federal/nationwide\n"
                "- regional: state/province/region/district\n"
                "- local: city/town/neighborhood/community/family/household\n"
                "When ambiguous, choose the SMALLEST plausible scope, but report low confidence.\n"}
            user = {"role":"user","content": json.dumps({
                "examples": [{"evidence": e, "scope": s} for e, s in self.FEW_SHOTS],
                "input": to_q
            }, ensure_ascii=False)}
            resp = self.h.client.responses.create(model=self.cfg.model, input=[system, user], text={"verbosity":"low"})
            text = _OpenAIHandle.parse_text(resp)
            try:
                items = json.loads(text).get("items", [])
            except Exception:
                items = []
            for i2, ev in enumerate(to_q):
                it = items[i2] if i2 < len(items) and isinstance(items[i2], dict) else {}
                sc = str(it.get("scope", "")).lower().strip()
                cf = float(it.get("confidence", 0.5))
                if sc not in {"global","national","regional","local"}:
                    sc = normalize_scope_rule_based_4(ev); cf = 0.45
                self.cache[self._key(ev)] = (sc, max(0.0, min(1.0, cf)))

        scopes, confs = [], []
        for ev in evidences:
            sc, cf = self.cache.get(self._key(ev), (normalize_scope_rule_based_4(ev), 0.45))
            scopes.append(sc); confs.append(cf)
        return scopes, confs

def rebalance_scopes(scopes: List[str], confs: List[float], evidences: List[str]) -> List[str]:
    """Push toward an even split by reassigning LOW-confidence rows first; never override hard cues."""
    n = len(scopes); target = n / 4.0
    counts = {k: scopes.count(k) for k in ["global","national","regional","local"]}
    def hard_lock(ev: str, sc: str) -> bool:
        t = (ev or "").lower()
        if sc == "global"   and re.search(r"\b(international|global|worldwide|multi-?country)\b", t): return True
        if sc == "national" and re.search(r"\b(national|nationwide|whole country|federal)\b", t):     return True
        if sc == "regional" and re.search(r"\b(state|province|regional|district)\b", t):              return True
        if sc == "local"    and re.search(r"\b(city|town|neighborhood|community|household|family)\b", t): return True
        return False
    order = sorted(range(n), key=lambda i: confs[i])  # lowest confidence first
    for i in order:
        sc, cf, ev = scopes[i], confs[i], evidences[i]
        if cf >= 0.55 or hard_lock(ev, sc): continue
        want = min(counts, key=lambda k: counts[k] - target)
        if counts[want] < target - 0.5 and want != sc:
            counts[sc] -= 1; counts[want] += 1; scopes[i] = want
    return scopes

# --------------------------- Rule-based helpers ----------------------------
def _has_negation(t: str) -> bool:
    tl = t.lower()
    return any(tok in tl for tok in NEGATION_TOKENS)

def _cadence_multiplier(t: str) -> float:
    tl = t.lower()
    if "daily" in tl: return 20.0
    if "weekly" in tl: return 4.0
    if "biweekly" in tl or "bi-weekly" in tl: return 2.0
    if "monthly" in tl: return 1.0
    if "quarterly" in tl: return 0.5
    return 0.0

def rule_based_estimate(txt: str) -> Tuple[dict, dict]:
    t = (txt or "").lower()
    mult = _cadence_multiplier(t)
    hours_direct = 0.0; hours_organizing = 0.0
    if any(k in t for k in ["meet", "canvas", "event", "rally", "callbank", "phonebank", "tabling"]):
        hours_direct = max(hours_direct, (2.0 if mult == 0 else 2.0 * mult))
    if any(k in t for k in ["organize", "planning", "logistics", "coordination", "coordinate"]):
        hours_organizing = max(hours_organizing, (4.0 if mult == 0 else 1.0 * mult))
    m = re.search(r"\$\s*([\d,]+)", t)
    dollars = float(m.group(1).replace(",", "")) if m else (25.0 * mult if "donat" in t else 0.0)
    adv = 0.0
    if any(k in t for k in ["post", "blog", "newsletter", "op-ed", "speech", "write", "podcast", "video"]):
        adv = max(adv, (1.0 if mult == 0 else 1.0 * mult))
    rec = 0.0
    mrec = re.search(r"\b(\d+)\s+(new|recruit|onboard|join|members?)", t)
    if mrec: rec = float(mrec.group(1))
    elif any(k in t for k in ["recruit", "onboard", "invite", "bring", "outreach"]):
        rec = max(rec, 0.5 * mult if mult > 0 else 1.0)
    learn = 0.0
    if any(k in t for k in ["training", "workshop", "class", "course", "seminar", "teach-in"]):
        learn = max(learn, 4.0 if mult == 0 else 2.0 * mult)
    actions = {
        "hours_direct": round(hours_direct, 3),
        "hours_organizing": round(hours_organizing, 3),
        "dollars_donated": round(dollars, 2),
        "advocacy_outputs": round(adv, 3),
        "recruitment_count": round(rec, 3),
        "learning_hours": round(learn, 3),
    }
    opp = {k: 0.5 for k in actions}
    if any(k in t for k in ["two jobs", "overtime", "caregiv", "child", "elder", "full-time student"]):
        opp = {k: 0.7 for k in actions}
    if any(k in t for k in ["plenty of time", "on sabbatical", "gap year"]):
        opp = {k: 0.3 for k in actions}
    return actions, opp

# --------------------------- LLM: Action Extractor -------------------------
class LLMActionExtractor:
    ACTION_KEYS = ["hours_direct","hours_organizing","dollars_donated",
                   "advocacy_outputs","recruitment_count","learning_hours"]

    FEW_SHOTS = [
        {
            "text": "Weekly canvassing 3h, organizes a monthly cleanup 6h, posts a city-council recap each week, recruited 2 friends. Student in finals.",
            "out": {"hours_direct":12, "hours_organizing":6, "dollars_donated":0,
                    "advocacy_outputs":4, "recruitment_count":2, "learning_hours":2,
                    "opp":{"hours_direct":0.6,"hours_organizing":0.8,"dollars_donated":0.1,
                           "advocacy_outputs":0.2,"recruitment_count":0.4,"learning_hours":0.5}}
        },
        {
            "text": "Donates $300 monthly, writes an op-ed occasionally, no events. Works two jobs.",
            "out": {"hours_direct":0, "hours_organizing":0, "dollars_donated":300,
                    "advocacy_outputs":1, "recruitment_count":0, "learning_hours":0,
                    "opp":{"hours_direct":0.7,"hours_organizing":0.7,"dollars_donated":0.5,
                           "advocacy_outputs":0.3,"recruitment_count":0.3,"learning_hours":0.4}}
        },
        {
            "text": "Neighborhood group meets weekly (2h). One organizer spends 8h planning. Onboards 5 new volunteers; attends a weekend training (6h).",
            "out": {"hours_direct":8, "hours_organizing":8, "dollars_donated":0,
                    "advocacy_outputs":0, "recruitment_count":5, "learning_hours":6,
                    "opp":{"hours_direct":0.3,"hours_organizing":0.5,"dollars_donated":0.1,
                           "advocacy_outputs":0.1,"recruitment_count":0.4,"learning_hours":0.3}}
        }
    ]

    def __init__(self, cfg: LLMBaseConfig, h: _OpenAIHandle):
        self.cfg, self.h = cfg, h

    @staticmethod
    def _payload_row(text: str) -> dict:
        return {"text": (text or "")[:2000]}

    def _request(self, texts: List[str]) -> List[dict] | None:
        system = {
            "role": "system",
            "content":
                "Extract per-person MONTHLY action magnitudes and opportunity costs (0..1). "
                "ALWAYS ESTIMATE reasonable monthly numbers from cadence and hints if exact numbers are missing. "
                "Heuristics (unless contradicted): daily≈20/mo; weekly≈4/mo; biweekly≈2/mo; monthly≈1/mo; quarterly≈0.5/mo. "
                "Hours: meeting≈2h per occurrence; organizing≈4h if mentioned; advocacy outputs per cadence; "
                "recruitment from onboard/invite; learning 2–6h per training/workshop/class. "
                "Only output ZERO when explicitly denied (e.g., 'no events', 'none', 'did not'). "
                "Opportunity costs (opp in [0,1]): infer constraints (workload, caregiving, school): low≈0.2, medium≈0.5, high≈0.8. "
                "Return ONLY JSON with key 'actions', an array matching input length. Numbers only."
        }
        user = {"role":"user","content": json.dumps({
            "schema_keys": self.ACTION_KEYS,
            "few_shots": self.FEW_SHOTS,
            "input": [self._payload_row(t) for t in texts]
        }, ensure_ascii=False)}
        resp = self.h.client.responses.create(model=self.cfg.model, input=[system, user],
                                              text={"verbosity":"low"})
        text = _OpenAIHandle.parse_text(resp)
        try:
            arr = json.loads(text).get("actions", [])
            return arr if isinstance(arr, list) else None
        except Exception:
            return None

    def extract(self, texts: List[str]) -> List[dict]:
        if not texts: return []
        arr = self._request(texts)
        if arr is None or len(arr) != len(texts):
            log(f"      ⚠️ action LLM returned {('none' if arr is None else len(arr))} for {len(texts)} inputs; retrying once…")
            arr = self._request(texts)
        out: List[dict] = []
        zero_vecs = 0
        for i in range(len(texts)):
            row = {}
            t = texts[i] if i < len(texts) else ""
            if isinstance(arr, list) and i < len(arr) and isinstance(arr[i], dict):
                row = arr[i]
            actions = {k: float(row.get(k, 0) or 0) for k in self.ACTION_KEYS}
            opp = row.get("opp", {})
            if not isinstance(opp, dict): opp={}
            opp = {k: min(1.0,max(0.0, float(opp.get(k, 0.5) or 0.5))) for k in self.ACTION_KEYS}
            guessed_actions, guessed_opp = rule_based_estimate(t)
            for k in self.ACTION_KEYS:
                if actions.get(k, 0.0) == 0.0 and not _has_negation(t):
                    actions[k] = guessed_actions[k]
            if not _has_negation(t) and all(v == 0.0 for v in actions.values()):
                actions = guessed_actions.copy()
            if all(v == 0.0 for v in actions.values()):
                zero_vecs += 1
            out.append({"actions": actions, "opp": opp})
        if zero_vecs:
            log(f"      ℹ️ action batch zeros (after safeguard): {zero_vecs}/{len(out)}")
        if zero_vecs / max(1, len(out)) >= 0.7:
            log("      ⚠️ LLM outputs mostly zeros; enforcing rule-based estimates for zero rows in this batch.")
            for i in range(len(out)):
                if all(v == 0.0 for v in out[i]["actions"].values()) and not _has_negation(texts[i]):
                    est_a, est_o = rule_based_estimate(texts[i])
                    out[i] = {"actions": est_a, "opp": est_o}
        return out

# --------------------------- LLM: Atmosphere Extractor ----------------------
class LLMAtmosphereExtractor:
    """Outputs (warmth, energy, formality) in [0,1] per row."""
    FEW_SHOTS = [
        {"text": "celebratory, welcoming, playful; weekly gatherings; informal potlucks",
         "out": {"warmth": 0.85, "energy": 0.70, "formality": 0.20}},
        {"text": "contemplative, scholarly; monthly salons; rigorous debate; structured agenda",
         "out": {"warmth": 0.35, "energy": 0.30, "formality": 0.70}},
        {"text": "disciplined, ceremonial; protocol and hierarchy; quarterly assemblies",
         "out": {"warmth": 0.45, "energy": 0.25, "formality": 0.85}},
    ]
    def __init__(self, cfg: LLMBaseConfig, h: _OpenAIHandle):
        self.cfg, self.h = cfg, h
    @staticmethod
    def _payload_row(values: str, practices: str, affils: str) -> dict:
        text = f"values: {values or ''} | practices: {practices or ''} | own_words: {affils or ''}"
        return {"text": text[:2000]}
    def extract(self, values_col: List[str], practices_col: List[str], affils_col: List[str]) -> List[Tuple[float,float,float]]:
        system = {"role":"system","content":
            "Read each item's text and output normalized scores in [0,1] for: "
            "warmth (affective/expressive), energy (tempo/activation), formality (structure/ritual). "
            "Return ONLY JSON: {\"traits\": [{\"warmth\":0..1, \"energy\":0..1, \"formality\":0..1}, ...]} "
            "Same order/length as input. Numbers only."}
        user = {"role":"user","content": json.dumps({
            "few_shots": self.FEW_SHOTS,
            "input": [self._payload_row(v, p, a) for v, p, a in zip(values_col, practices_col, affils_col)]
        }, ensure_ascii=False)}
        resp = self.h.client.responses.create(model=self.cfg.model, input=[system, user],
                                              text={"verbosity":"low"})
        text = _OpenAIHandle.parse_text(resp)
        try:
            arr = json.loads(text).get("traits", [])
        except Exception:
            arr = []
        out: List[Tuple[float,float,float]] = []
        for i in range(len(values_col)):
            row = arr[i] if i < len(arr) and isinstance(arr[i], dict) else {}
            w = float(row.get("warmth", 0.5) or 0.5)
            e = float(row.get("energy", 0.5) or 0.5)
            f = float(row.get("formality", 0.5) or 0.5)
            out.append((max(0,min(1,w)), max(0,min(1,e)), max(0,min(1,f))))
        return out

def fallback_traits(values_col: List[str], practices_col: List[str]) -> List[Tuple[float, float, float]]:
    res: List[Tuple[float, float, float]] = []
    for v, p in zip(values_col, practices_col):
        txt = f"{v or ''} {p or ''}".lower()
        warmth = 0.50
        if re.search(r"\b(warm|welcom|friendly|celebrat|playful|care|solidar|joy)\b", txt): warmth += 0.20
        if re.search(r"\b(reserved|formalistic|analytical|distant|stoic)\b", txt): warmth -= 0.10
        energy = 0.30
        energy += 0.25 * bool(re.search(r"\bdaily\b", txt))
        energy += 0.15 * bool(re.search(r"\bweekly\b", txt))
        energy += 0.05 * bool(re.search(r"\bmonthly|regular\b", txt))
        energy += 0.10 * bool(re.search(r"\brally|march|canvass|campaign|festival\b", txt))
        formality = 0.40
        formality += 0.25 * bool(re.search(r"\b(protocol|ceremon|orthodox|hierarch|bylaws|charter)\b", txt))
        formality -= 0.15 * bool(re.search(r"\binformal|casual|loose\b", txt))
        formality += 0.10 * bool(re.search(r"\bagenda|minutes|governance|committee\b", txt))
        res.append((max(0,min(1,warmth)), max(0,min(1,energy)), max(0,min(1,formality))))
    return res

# ---------------------- LLM: Kinships & Affiliation (scapes) ----------------
class LLMKinAff:
    """
    Returns per row:
      {"affiliation": <name or null>, "kinships": [names...]}
    Constraints:
      - Only choose from known_names.
      - Affiliation: ≤1 (hierarchical/hosting); MUST be exactly one scope tier larger.
      - Kinships: 3–10 peers (non-hierarchical). Prefer ≥2 scapes; cap Mediascape-only ≤50%.
    """
    _PARENTS_RE = re.compile(r"(chapter of|under|part of|member of|hosted by|subsidiary|fiscal sponsor|governed by)", re.I)
    _FINANCE_RE = re.compile(r"(grant|fund|budget|payroll|fiscal host|sponsor(ship)?)", re.I)
    _TECH_RE    = re.compile(r"(platform|sso|crm|infrastructure|tenancy|integration)", re.I)
    _IDEO_RE    = re.compile(r"(charter|bylaws|constitution|doctrine|manifesto)", re.I)
    _MEDIA_RE   = re.compile(r"(co-?brand|official channel|brand(ed)?)", re.I)
    _ETHNO_RE   = re.compile(r"(appointed|staffed by|seconded)", re.I)

    def __init__(self, cfg: LLMBaseConfig, h: _OpenAIHandle):
        self.cfg, self.h = cfg, h

    @staticmethod
    def _payload_row(self_name: str, kin_text: str, aff_text: str) -> dict:
        return {"self": self_name, "kin_text": (kin_text or "")[:2000], "aff_text": (aff_text or "")[:2000]}

    def _request(self, rows: List[dict], known_names: List[str]) -> List[dict] | None:
        system = {
            "role": "system",
            "content":
                "Extract a culture's Affiliation (single parent) and Kinships (3–10 peers) using Appadurai's scapes. "
                "Use ONLY the provided known_cultures list. Do not invent unseen names. "
                "Affiliation: hierarchical/hosting ('chapter of','under','member of','hosted by','fiscal sponsor','governed by'). "
                "Return at most one affiliation; if multiple candidates appear, choose the strongest single parent. "
                "Kinships: peer collaborations with evidence in ≥2 scapes (Ethno/Tech/Finance/Media/Ideo) or strong single scape (Finance or Tech with MoU). "
                "Limit Mediascape-only links to ≤50%. If Affiliation chosen, do not include it in Kinships. "
                "Return ONLY JSON: {\"items\": [{\"affiliation\": <name or null>, \"kinships\": [names...]}, ...]} (same order/length)."
        }
        known = known_names[:300]
        user = {"role":"user","content": json.dumps({"known_cultures": known, "input": rows}, ensure_ascii=False)}
        resp = self.h.client.responses.create(model=self.cfg.model, input=[system, user], text={"verbosity":"low"})
        text = _OpenAIHandle.parse_text(resp)
        try:
            items = json.loads(text).get("items", [])
            return items if isinstance(items, list) else None
        except Exception:
            return None

    # --------- helpers ----------
    # ADD inside LLMKinAff
    def _resolve_to_known(self, cand: str, known_names: List[str], min_sim: float = 0.68) -> Optional[str]:
        """Token-Jaccard fuzzy match LLM parent to a known culture name."""
        if not isinstance(cand, str) or not cand.strip(): 
            return None
        def norm(s: str) -> List[str]:
            s = re.sub(r"[^\w\s]", " ", s.lower())
            return [t for t in re.split(r"\s+", s) if t]
        base = set(norm(cand))
        if not base: 
            return None
        best, best_sim = None, 0.0
        for k in known_names:
            ks = set(norm(k))
            if not ks: 
                continue
            inter = len(base & ks); uni = len(base | ks)
            sim = inter / uni if uni else 0.0
            if sim > best_sim or (sim == best_sim and stable_hash_int(k) < stable_hash_int(best or "")):
                best, best_sim = k, sim
        return best if best_sim >= min_sim else None


    def _parse_parent_field(self, parent_field) -> List[str]:
        if parent_field is None: return []
        if isinstance(parent_field, list): return [p for p in parent_field if isinstance(p, str) and p.strip()]
        if isinstance(parent_field, str):
            parts = re.split(r"\s*(?:[,;/]| and )\s*", parent_field)
            return [p.strip() for p in parts if p.strip()]
        return []

    def _score_parent(self, cand: str, kin_text: str, aff_text: str) -> float:
        txt = f"{kin_text or ''} {aff_text or ''}"
        score = 0.0
        score += 3.0 * bool(self._PARENTS_RE.search(txt))
        score += 2.0 * bool(self._FINANCE_RE.search(txt))
        score += 2.0 * bool(self._TECH_RE.search(txt))
        score += 1.0 * bool(self._IDEO_RE.search(txt))
        score += 1.0 * bool(self._MEDIA_RE.search(txt))
        score += 1.0 * bool(self._ETHNO_RE.search(txt))
        score += (stable_hash_int(cand) % 7) * 1e-3
        return score

    def _scope_level(self, name: str, name_to_scope: Dict[str, str]) -> Optional[int]:
        s = (name_to_scope.get(name, "") or "").lower()
        return SCOPE_LEVEL.get(s)

    def _level_ok(self, child: str, parent: str, name_to_scope: Dict[str, str]) -> bool:
        c = self._scope_level(child, name_to_scope); p = self._scope_level(parent, name_to_scope)
        return (c is not None) and (p is not None) and (p > c)

    # REPLACE in LLMKinAff
    def _pick_affiliation(self, self_name: str, candidates: List[str], kin_text: str, aff_text: str,
                        known_set: set, name_to_scope: Dict[str, str], threshold: float = 1.0) -> Optional[str]:
        """
        Accept the LLM's single parent if:
        - it exists in known_set (exact or fuzzily resolved upstream), and
        - it is higher scope (p > c).
        Otherwise, if multiple candidates, pick the highest _score_parent, but with a LOW threshold.
        """
        # filter to known + higher scope
        filtered = [c for c in candidates if c and c != self_name and c in known_set and self._level_ok(self_name, c, name_to_scope)]
        if not filtered:
            return None

        # If only one valid candidate, accept it WITHOUT requiring regex evidence.
        if len(filtered) == 1:
            return filtered[0]

        # Otherwise choose best by evidence score, but with a mild threshold
        best = max(filtered, key=lambda c: self._score_parent(c, kin_text, aff_text))
        return best if self._score_parent(best, kin_text, aff_text) >= threshold else filtered[0]


    @staticmethod
    def _nearest_names(self_name: str, known: List[str], k: int) -> List[str]:
        base = set(re.split(r"\s+", self_name.lower()))
        def sim(n):
            s = set(re.split(r"\s+", n.lower()))
            inter = len(base & s); uni = len(base | s) or 1
            return inter/uni
        cand = [n for n in known if n and n != self_name]
        cand.sort(key=lambda n: (sim(n), -stable_hash_int(n)), reverse=True)
        return cand[:k]

    @staticmethod
    def _extract_mentions(text: str, known: List[str]) -> List[str]:
        t = (text or "").lower(); out=[]
        for n in known:
            if not n: continue
            pat = re.escape(n.lower())
            if re.search(rf"\b{pat}\b", t): out.append(n)
        return out

    def _fallback_one(self, self_name: str, kin_text: str, aff_text: str, known: List[str]) -> dict:
        known_wo_self = [n for n in known if n and n != self_name]
        parent = None
        aff_cand = self._extract_mentions(aff_text, known_wo_self) + self._extract_mentions(kin_text, known_wo_self)
        if aff_cand:
            for n in aff_cand:
                if re.search(self._PARENTS_RE, (kin_text+" "+aff_text).lower()): parent = n; break
        kin_raw = self._extract_mentions(kin_text, known_wo_self)
        kin = [n for n in kin_raw if n != parent]
        if len(kin) < 3:
            pad = [n for n in self._nearest_names(self_name, known, 10) if n not in kin and n != parent]
            kin.extend(pad[: (3-len(kin)) ])
        if len(kin) > 10: kin = kin[:10]
        return {"affiliation": parent, "kinships": kin}

    def extract(self, self_names: List[str], kin_col: List[str], aff_col: List[str],
                known_names: List[str], name_to_scope: Dict[str, str]) -> List[dict]:
        rows = [self._payload_row(self_names[i], kin_col[i], aff_col[i]) for i in range(len(self_names))]
        arr = self._request(rows, known_names)
        out: List[dict] = []
        if arr is None or len(arr) != len(rows):
            log("      ⚠️ kin/affil LLM failed or size mismatch; applying rule-based fallback for this batch.")
            for i in range(len(rows)):
                out.append(self._fallback_one(self_names[i], kin_col[i], aff_col[i], known_names))
            return out
        for i, itm in enumerate(arr):
            self_name = self_names[i]
            parent_raw = itm.get("affiliation", None)
            # ADD: resolve LLM parent text to a known culture name if needed
            if isinstance(parent_raw, str):
                resolved = self._resolve_to_known(parent_raw, known_names)
                if resolved:
                    parent_raw = resolved
            elif isinstance(parent_raw, list):
                tmp = []
                for p in parent_raw:
                    r = self._resolve_to_known(p, known_names)
                    if r: tmp.append(r)
                parent_raw = tmp if tmp else None

            kin = itm.get("kinships", [])
            parent_list = self._parse_parent_field(parent_raw)

            # ADD DEBUG (you can keep these or remove later)
            if not parent_list:
                log(f"      [affil] {self_name}: LLM returned no parent candidates")
            elif parent is None:
                reasons = []
                for c in parent_list:
                    if c not in known_set:
                        reasons.append(f"{c}: not in known_set")
                    elif not self._level_ok(self_name, c, name_to_scope):
                        reasons.append(f"{c}: scope not higher")
                    else:
                        s = self._score_parent(c, kin_col[i], aff_col[i])
                        reasons.append(f"{c}: low evidence score={s:.2f}")
                log(f"      [affil] {self_name}: rejected → " + "; ".join(reasons))
            else:
                log(f"      [affil] {self_name}: accepted parent = {parent}")

            known_set = set(known_names)
            parent = self._pick_affiliation(self_name, parent_list, kin_col[i], aff_col[i], known_set, name_to_scope, threshold=5.0)
            kin = [x for x in kin if isinstance(x, str) and x in known_set and x != self_name]
            kin = list(dict.fromkeys(kin))
            kin = [x for x in kin if x != parent]
            if len(kin) < 3:
                pads = [n for n in self._nearest_names(self_name, known_names, 12) if n not in kin and n != parent]
                kin.extend(pads[: (3 - len(kin)) ])
            if len(kin) > 10: kin = kin[:10]
            out.append({"affiliation": parent, "kinships": kin})
        return out

# ---------------------------- Energy + Particles ---------------------------
@dataclass
class EnergyConfig:
    w_hours_direct: float = 1.0
    w_hours_organizing: float = 1.4
    w_dollars_donated: float = 0.004   # ~$250 ≈ 1 hour
    w_advocacy_outputs: float = 0.25
    w_recruitment_count: float = 0.8
    w_learning_hours: float = 0.6
    lam: float = 0.5  # λ in [0,1]
    interior_min: int = 20
    interior_max: int = 260
    edge_base: int = 4
    edge_energy_boost: int = 2
    min_total_particles: int = 50
    z_clip: float = 2.5
    def weights(self) -> Dict[str, float]:
        return {
            "hours_direct": self.w_hours_direct,
            "hours_organizing": self.w_hours_organizing,
            "dollars_donated": self.w_dollars_donated,
            "advocacy_outputs": self.w_advocacy_outputs,
            "recruitment_count": self.w_recruitment_count,
            "learning_hours": self.w_learning_hours,
        }

def compute_energy_per_row(vec: Dict[str,float], opp: Dict[str,float], cfg: EnergyConfig) -> float:
    E=0.0; w=cfg.weights()
    for k,v in vec.items():
        E += w.get(k,0.0) * float(v) * (1.0 + cfg.lam * float(opp.get(k,0.3)))
    return E

def clamp_zscore(values: List[float], z_clip: float) -> List[float]:
    if not values: return []
    s = pd.Series(values)
    z = (s - s.mean()) / (s.std(ddof=0) + 1e-9)
    z = z.clip(lower=-z_clip, upper=z_clip)
    mn, mx = z.min(), z.max()
    if mx - mn < 1e-9: return [0.5]*len(values)
    return ((z - mn) / (mx - mn)).tolist()

def compute_viz_derivatives_from_energy(
    name: str,
    kinships_str: str,
    openness: int,
    normE: float,
    ecfg: EnergyConfig,
) -> Dict[str, object]:
    kinships_list = split_list_field(kinships_str)
    kinships_count = len(kinships_list)
    sides = max(3, kinships_count if kinships_count > 0 else 3)
    interior = int(math.floor(ecfg.interior_min + normE * (ecfg.interior_max - ecfg.interior_min)))
    particles_per_edge = ecfg.edge_base + math.floor((11 - int(openness)) * 0.5) + int(math.floor(normE * ecfg.edge_energy_boost))
    border = sides * max(1, particles_per_edge)
    total = interior + border
    if total < ecfg.min_total_particles:
        interior += (ecfg.min_total_particles - total)
        total = interior + border
    return {
        "KinshipsCount": kinships_count,
        "Sides": sides,
        "InteriorParticleCount": interior,
        "ParticlesPerEdge": particles_per_edge,
        "BorderParticleCount": border,
        "TotalParticleCount": total,
    }

# -------------------------------- Transform --------------------------------
def process_dataframe(df_in: pd.DataFrame, overrides: Dict[str, Optional[str]]|None) -> pd.DataFrame:
    overrides = overrides or {k: None for k in ALIASES}

    # 1) pick base columns
    name_raw = pick_series(df_in,"name",overrides.get("name"))
    values_raw = pick_series(df_in,"values",overrides.get("values"))
    kinships_text = pick_series(df_in,"kinships",overrides.get("kinships"))     # free text
    kb_raw = pick_series(df_in,"knowledgebase",overrides.get("knowledgebase"))
    open_raw = pick_series(df_in,"openness",overrides.get("openness"))
    scope_free = pick_series(df_in,"scope",overrides.get("scope"))              # "Scope of Your Culture"
    practices_raw = pick_series(df_in,"practices",overrides.get("practices"))
    own_words = pick_series(df_in,"affiliations",overrides.get("affiliations")) # "Your Own Words" (aliased)

    total = len(df_in)
    start_ts = time.time()
    log("[2/12] Initializing GPT-5 client…")
    h = _OpenAIHandle()
    llm_cfg = LLMBaseConfig(batch_size=8)

    # 2) names
    log("[3/12] Normalizing names…")
    llm_names = LLMNames(llm_cfg, h)
    norm_names: List[str] = []
    batch, processed = [], 0
    for i in range(total):
        batch.append(str(name_raw.iloc[i]))
        if len(batch) >= llm_cfg.batch_size:
            norm_names.extend(llm_names.normalize(batch)); batch.clear()
            processed = min(processed + llm_cfg.batch_size, total)
            log_progress("      names processed", processed, total, start_ts)
    if batch:
        norm_names.extend(llm_names.normalize(batch))
        log_progress("      names processed", total, total, start_ts)

    # 3) Dedupe by normalized Name (keep first)
    keep_idx, seen = [], set()
    for i, nm in enumerate(norm_names):
        key = (nm or "").strip().lower()
        if key in seen: continue
        seen.add(key); keep_idx.append(i)
    dropped = len(norm_names) - len(keep_idx)
    if dropped > 0:
        log(f"      🔁 dedup: removed {dropped} duplicate row(s) by Name")
    def _flt(series: pd.Series) -> pd.Series:
        return series.iloc[keep_idx].reset_index(drop=True)
    name_raw      = _flt(name_raw)
    values_raw    = _flt(values_raw)
    kinships_text = _flt(kinships_text)
    kb_raw        = _flt(kb_raw)
    open_raw      = _flt(open_raw)
    scope_free    = _flt(scope_free)
    practices_raw = _flt(practices_raw)
    own_words     = _flt(own_words)
    norm_names = [norm_names[i] for i in keep_idx]
    total = len(norm_names)

    # 4) scopes from multi-field evidence
    log("[4/12] Deciding scopes…")
    llm_scopes = LLMScopes(llm_cfg, h)
    evidences = [
        f"declared_scope: {str(scope_free.iloc[i])} | values_traits: {str(values_raw.iloc[i])} | own_words: {str(own_words.iloc[i])}"
        for i in range(total)
    ]
    try:
        norm_scopes, scope_conf = llm_scopes.decide(evidences)
        norm_scopes = rebalance_scopes(norm_scopes, scope_conf, evidences)
        name_to_scope = { norm_names[i]: norm_scopes[i] for i in range(total) }
    except Exception as e:
        log(f"      ⚠️ scopes LLM error; using rule-based: {e}")
        norm_scopes = [normalize_scope_rule_based_4(ev) for ev in evidences]
        scope_conf  = [0.45] * total
        name_to_scope = { norm_names[i]: norm_scopes[i] for i in range(total) }
    dist = {k: norm_scopes.count(k) for k in ["global","national","regional","local"]}
    log(f"      scope distribution → {dist}")
    log_progress("      scopes done", total, total, start_ts)

    # 5) actions text (for estimation)
    log("[5/12] Collecting actions…")
    schema_keys = LLMActionExtractor.ACTION_KEYS
    num_cols = {k: df_in[k].iloc[keep_idx].fillna(0) for k in schema_keys if k in df_in.columns}
    opp_cols = {k: df_in[f"opp_{k}"].iloc[keep_idx].fillna(0.5) for k in schema_keys if f"opp_{k}" in df_in.columns}
    texts_for_actions = [f"values: {values_raw.iloc[i]} | practices: {practices_raw.iloc[i]} | own_words: {own_words.iloc[i]}"
                         for i in range(total)]
    nonempty = sum(1 for t in texts_for_actions if isinstance(t, str) and t.strip())
    log(f"      action text non-empty: {nonempty}/{total}")
    if nonempty == 0:
        log("      ⚠️ All action texts are empty. Check column headers / overrides (--delimiter, --name, etc.).")

    actions_list: List[dict] = []
    if len(num_cols) == len(schema_keys) and len(opp_cols) == len(schema_keys):
        for i in range(total):
            actions = {k: float(num_cols[k].iloc[i] or 0) for k in schema_keys}
            opp = {k: float(max(0,min(1, opp_cols[k].iloc[i] if k in opp_cols else 0.5))) for k in schema_keys}
            if all(v == 0.0 for v in actions.values()) and not _has_negation(texts_for_actions[i]):
                est_a, est_o = rule_based_estimate(texts_for_actions[i]); actions, opp = est_a, est_o
            actions_list.append({"actions":actions,"opp":opp})
        log("      using numeric action overrides from CSV (with estimation safeguard)")
    else:
        log("      extracting actions via GPT-5 (must estimate)…")
        llm_actions = LLMActionExtractor(llm_cfg, h)
        processed = 0
        for i in range(0, total, llm_cfg.batch_size):
            chunk = texts_for_actions[i:i+llm_cfg.batch_size]
            try:
                actions_list.extend(llm_actions.extract(chunk))
            except Exception as e:
                log(f"      ⚠️ actions LLM error rows {i+1}..{min(i+llm_cfg.batch_size,total)}: {e}")
                for j,_ in enumerate(chunk):
                    est_a, est_o = rule_based_estimate(chunk[j])
                    actions_list.append({"actions": est_a, "opp": est_o})
            processed = min(i+llm_cfg.batch_size, total)
            log_progress("      actions processed", processed, total, start_ts)

    # 6) energy
    log("[6/12] Computing energy…")
    ecfg = EnergyConfig()
    energies: List[float] = []
    for i in range(total):
        energies.append(compute_energy_per_row(actions_list[i]["actions"], actions_list[i]["opp"], ecfg))
        if (i+1)%200==0 or (i+1)==total:
            log_progress("      energy rows", i+1, total, start_ts)
    if (max(energies) - min(energies)) < 1e-9:
        log("      ⚠️ All energies are identical → NormEnergy = 0.5 → Interior ≈ 140 for every row.")
    normE = clamp_zscore(energies, z_clip=ecfg.z_clip)

    # 7) Kinships + Affiliation (scapes) with scope-level check
    log("[7/12] Extracting kinships + affiliation (scapes)…")
    kin_aff = LLMKinAff(llm_cfg, h)
    kin_texts = [str(kinships_text.iloc[i]) for i in range(total)]
    aff_texts = [str(own_words.iloc[i]) for i in range(total)]  # rich text for parent cues
    kin_aff_results: List[dict] = []
    for i in range(0, total, llm_cfg.batch_size):
        chunk_self = norm_names[i:i+llm_cfg.batch_size]
        chunk_kin  = kin_texts[i:i+llm_cfg.batch_size]
        chunk_aff  = aff_texts[i:i+llm_cfg.batch_size]
        try:
            kin_aff_results.extend(kin_aff.extract(chunk_self, chunk_kin, chunk_aff, norm_names, name_to_scope))
        except Exception as e:
            log(f"      ⚠️ kin/affil LLM error rows {i+1}..{min(i+llm_cfg.batch_size,total)}: {e}")
            for j in range(len(chunk_self)):
                kin_aff_results.append(kin_aff._fallback_one(chunk_self[j], chunk_kin[j], chunk_aff[j], norm_names))
        log_progress("      kin/affil processed", min(i+llm_cfg.batch_size,total), total, start_ts)

    # 8) Atmosphere → Color
    log("[8/12] Deriving atmosphere traits and assigning colors…")
    if "LLMAtmosphereExtractor" not in globals():
        raise RuntimeError("Programmer error: LLMAtmosphereExtractor is not defined (check class order).")
    def _is_openai_api_error(err: Exception) -> bool:
        name = err.__class__.__name__
        return name in {"APIError","APIStatusError","RateLimitError","APITimeoutError",
                        "BadRequestError","AuthenticationError","InternalServerError"}
    try:
        atm = LLMAtmosphereExtractor(llm_cfg, h)
        traits_list = atm.extract(
            [str(values_raw.iloc[i]) for i in range(total)],
            [str(practices_raw.iloc[i]) for i in range(total)],
            [str(own_words.iloc[i]) for i in range(total)],
        )
    except Exception as e:
        if _is_openai_api_error(e):
            log(f"      ⚠️ atmosphere LLM API error, using fallback traits: {e}")
            traits_list = fallback_traits(
                [str(values_raw.iloc[i]) for i in range(total)],
                [str(practices_raw.iloc[i]) for i in range(total)],
            )
        else:
            raise
    color_hexes = assign_colors_divergent(
        [norm_names[i] for i in range(total)],
        traits_list,
        deltaE_min=0.22,
        max_iter=8,
    )

    # 9) build rows (+ diversify kinship count deterministically)
    log("[9/12] Building rows + particle counts…")
    rows=[]
    for i in range(total):
        name_n = norm_names[i]
        kb_n = parse_int_1_10(kb_raw.iloc[i], default=5)
        open_n = parse_int_1_10(open_raw.iloc[i], default=5)
        aff_final = kin_aff_results[i].get("affiliation", None)
        kin_list  = kin_aff_results[i].get("kinships", [])
        # Diverse target kin count by energy + small hash jitter
        e = float(normE[i])
        jitter = ((stable_hash_int(name_n) % 101) / 100.0 - 0.5) * 0.6   # [-0.3, +0.3]
        target_N = int(round(3 + 7 * max(0.0, min(1.0, e + jitter))))
        target_N = max(3, min(10, target_N))
        if len(kin_list) > target_N:
            kin_list = sorted(kin_list, key=lambda x: (stable_hash_int(name_n + "→" + x)))[:target_N]
        elif len(kin_list) < 3:
            pads = LLMKinAff._nearest_names(name_n, norm_names, 12)
            kin_list.extend([p for p in pads if p not in kin_list and p != aff_final][: (3 - len(kin_list)) ])
        kin_csv = ", ".join(kin_list)
        viz = compute_viz_derivatives_from_energy(name_n, kin_csv, open_n, normE[i], ecfg)
        row = {
            "Name": name_n,
            "Kinships": kin_csv,
            "Affiliation": (aff_final or ""),
            "Knowledgebase": kb_n,
            "Openness": open_n,
            "Scope": norm_scopes[i],
            "Sides": viz["Sides"],
            "InteriorParticleCount": viz["InteriorParticleCount"],
            "ParticlesPerEdge": viz["ParticlesPerEdge"],
            "BorderParticleCount": viz["BorderParticleCount"],
            "TotalParticleCount": viz["TotalParticleCount"],
            "Color": color_hexes[i],
        }
        rows.append(row)
        if (i+1)%200==0 or (i+1)==total:
            log_progress("      rows built", i+1, total, start_ts)

    df_out = pd.DataFrame(rows, columns=[
        "Name","Kinships","Affiliation","Knowledgebase","Openness","Scope",
        "Sides","InteriorParticleCount","ParticlesPerEdge","BorderParticleCount","TotalParticleCount","Color",
    ])

    log("[10/12] Verifying counts…")
    assert all(df_out["Sides"] >= 3), "Sides must be ≥3"
    assert all(df_out["TotalParticleCount"] >= 50), "TotalParticleCount must be ≥50"

    log("[11/12] Ready to write.")
    return df_out

# ----------------------------------- I/O -----------------------------------
def read_dataframe(path: Path, *, delimiter: Optional[str], has_header: bool) -> pd.DataFrame:
    if delimiter is None:
        try:    return pd.read_csv(path, header=0 if has_header else None)
        except Exception: return pd.read_csv(path, sep="\t", header=0 if has_header else None)
    return pd.read_csv(path, sep=delimiter, header=0 if has_header else None)

def write_dataframe(df: pd.DataFrame, path: Path) -> None:
    df.to_csv(path, index=False)

# ----------------------------------- CLI -----------------------------------
def build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Kinship Viz CSV processor (LLM names/scopes/actions + scape-aware kin/affil + energy + color).")
    p.add_argument("--in", dest="in_path", required=True, help="Input CSV path")
    p.add_argument("--out", dest="out_path", required=True, help="Output CSV path")
    p.add_argument("--delimiter", dest="delimiter", default=None, help=", | ; | \\t | custom")
    p.add_argument("--no-header", dest="no_header", action="store_true", help="CSV has no header row")
    p.add_argument("--name", dest="name", help="Header name for Name column (optional)")
    return p

def main(argv: Optional[Iterable[str]] = None) -> int:
    ap = build_argparser()
    args = ap.parse_args(argv)
    in_path, out_path = Path(args.in_path), Path(args.out_path)
    has_header = not args.no_header
    t0 = time.time()
    log("[1/12] Reading CSV…")
    if not in_path.exists(): ap.error(f"Input file not found: {in_path}")
    df_in = read_dataframe(in_path, delimiter=args.delimiter, has_header=has_header)
    log(f"      Loaded {len(df_in)} row(s)")
    df_out = process_dataframe(df_in, overrides={"name": args.name})
    log("[12/12] Writing output CSV…")
    write_dataframe(df_out, out_path)
    log(f"✅ Done in {time.time()-t0:.2f}s. Wrote: {out_path}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
