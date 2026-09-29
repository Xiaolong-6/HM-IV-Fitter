"""Column-name normalization and V/I column inference helpers for import_trace."""

from __future__ import annotations

from typing import Literal

def _header_key(name: object) -> str:
    raw = str(name).lower().strip()
    raw = raw.replace("µ", "u").replace("μ", "u")
    raw = raw.replace("ma/cm²", "macm2").replace("ma/cm2", "macm2")
    raw = raw.replace("ma cm-2", "macm2").replace("ma cm^-2", "macm2")
    raw = raw.replace("ma cm2", "macm2").replace("macm-2", "macm2")
    keep = []
    for ch in raw:
        if ch.isalnum():
            keep.append(ch)
    return "".join(keep)
def _trace_name_from_header(header: object) -> str:
    cleaned = str(header).strip().replace("[", " ").replace("]", " ")
    cleaned = " ".join(cleaned.replace("_", " ").split())
    return cleaned or "imported trace"
def _is_false_current_column(header: object) -> bool:
    key = _header_key(header)
    false_exact = {
        "row", "rows", "index", "idx", "point", "pointindex", "time", "times", "elapsed",
        "elapseds", "wavelength", "wavelengthnm", "lambda", "eqe", "pce", "efficiency",
        "ff", "fillfactor", "voc", "v_oc", "jsc", "j_sc", "area", "temperature", "temp",
    }
    if key in false_exact:
        return True
    return any(token in key for token in ("wavelength", "eqe", "pce", "fillfactor", "efficiency", "voc", "jsc"))
def _is_voltage_like(header: object) -> bool:
    key = _header_key(header)
    if key in {"v", "voltage", "voltagev", "vv", "bias", "biasv", "sourcev", "setv", "smuvoltagev", "measuredvoltagev"}:
        return True
    return ("voltage" in key or "bias" in key) and ("v" in key or "volt" in key)
def _is_trace_group_col(header: object) -> bool:
    key = _header_key(header)
    return key in {"trace", "traceid", "traceindex", "tracename", "sample", "sampleid", "device", "deviceid"}
def _current_metadata(header: object) -> dict | None:
    if _is_false_current_column(header) or _is_voltage_like(header) or _is_trace_group_col(header):
        return None
    key = _header_key(header)
    # Unit-bearing headers take precedence over the conventional variable
    # letter. In particular, publication source files may label an ordinary
    # current as J_A even when the paper reports I-V characteristics. Treat
    # explicit area-normalized units as density, while *_J_A remains current.
    has_density_unit = "macm2" in key or "acm2" in key
    explicit_amp_current = key.endswith("ja") and not has_density_unit
    is_density = (
        "currentdensity" in key
        or has_density_unit
        or key == "j"
        or ("jma" in key and not explicit_amp_current)
    )
    is_current = (
        is_density
        or explicit_amp_current
        or key in {"i", "a", "ma", "ia", "current", "currenta", "measuredcurrenta", "smucurrenta", "ch1"}
        or "current" in key
        or key.endswith("currenta")
        or key.endswith("ia")
        or key.endswith("ma")
    )
    if not is_current:
        return None
    meta = {"y_quantity": "current_density" if is_density else "current"}
    if is_density:
        meta["y_unit"] = "mA/cm2" if "macm2" in key else ("A" if key.endswith("ja") else "current_density")
    elif key.endswith("ma") or "currentma" in key:
        meta["y_unit"] = "mA"
    elif key.endswith("a") or "currenta" in key or key == "i":
        meta["y_unit"] = "A"
    return meta
def _infer_column(columns: list[str], kind: Literal["voltage", "current"], warnings: list[str] | None = None) -> str:
    candidates = {
        "voltage": [
            "v", "voltage", "voltage_v", "bias", "bias_v", "source_v", "set_v",
            "smu_voltage_v", "measured_voltage_v", "voltage (v)", "V",
        ],
        "current": [
            "i", "current", "current_a", "measured_current_a", "smu_current_a",
            "current (a)", "ch1", "CH1", "I",
        ],
    }[kind]
    def norm(s: str) -> str:
        return s.lower().strip().replace(" ", "_").replace("/", "_").replace("-", "_")
    normalized = {norm(c): c for c in columns}
    for cand in candidates:
        key = norm(cand)
        if key in normalized:
            return normalized[key]
    if kind == "voltage":
        for original in columns:
            if _is_voltage_like(original):
                return original
    if kind == "current":
        for original in columns:
            if _current_metadata(original):
                return original
    # HappyMeasure-style names often include units and role words. Prefer explicit measured columns.
    for key, original in normalized.items():
        if kind == "voltage" and "volt" in key and ("v" in key or "bias" in key or "source" in key or "measure" in key):
            return original
        if kind == "current" and ("current" in key or key.endswith("_a") or key == "i_a"):
            return original
    # fallback: preserve compatibility, but do not silently accept ambiguous column names.
    if kind == "voltage" and columns:
        if warnings is not None:
            warnings.append(f"Could not recognize a voltage column name; automatically selected first column {columns[0]!r}.")
        return columns[0]
    if kind == "current" and len(columns) > 1:
        if warnings is not None:
            warnings.append(f"Could not recognize a current column name; automatically selected second column {columns[1]!r}.")
        return columns[1]
    raise ValueError(f"Could not infer {kind} column from {columns!r}")
