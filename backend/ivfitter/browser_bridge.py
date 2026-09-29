"""Browser-local bridge for the static IV-fitter build.

This module intentionally mirrors the public FastAPI operations without importing
FastAPI. Pyodide calls call_json inside a Web Worker and receives ordinary JSON,
so the React frontend can keep the same TypeScript-facing contracts in server
and browser runtime modes.
"""

from __future__ import annotations

import json
import math
from datetime import date, datetime
from typing import Any

import numpy as np
from pydantic import BaseModel

from ivfitter.core.bounds_suggestion import BoundsSuggestionRequest, suggest_bounds
from ivfitter.core.component_registry import component_registry
from ivfitter.core.equations import generate_equations
from ivfitter.core.fitting_engine import fit_trace
from ivfitter.core.model_spec import FitRequest, FitResult, ModelSpec
from ivfitter.core.model_validation import validate_model_spec
from ivfitter.core.synthetic_trace import SyntheticTraceRequest, generate_synthetic_trace
from ivfitter.io.export_report import fit_result_markdown
from ivfitter.io.export_result import report_csv_text
from ivfitter.io.import_trace import ImportCsvTextRequest, import_csv_text_multi


def _json_safe(value: Any) -> Any:
    """Convert core/Pydantic/numpy results into strict JSON-compatible values."""
    if isinstance(value, BaseModel):
        return _json_safe(value.model_dump(mode="json"))
    if isinstance(value, np.ndarray):
        return _json_safe(value.tolist())
    if isinstance(value, np.generic):
        return _json_safe(value.item())
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _multi_import_response(items) -> dict[str, Any]:
    traces = [{"trace": trace, "quality": quality} for trace, quality in items]
    seen_warnings: dict[str, None] = {}
    for _trace, quality in items:
        for warning in getattr(quality, "warnings", []) or []:
            seen_warnings[str(warning)] = None
    warnings = list(seen_warnings)
    summary = None
    if len(items) > 1:
        first_meta = getattr(items[0][0], "metadata", {}) or {}
        summary = first_meta.get("import_summary") if isinstance(first_meta, dict) else None
        if not summary:
            summary = f"Imported {len(items)} traces."
    return {"traces": traces, "summary": summary, "warnings": warnings}


def _dispatch(method: str, payload: Any) -> Any:
    if method == "component_registry":
        return component_registry()
    if method == "validate_model":
        return validate_model_spec(ModelSpec.model_validate(payload))
    if method == "equations":
        return generate_equations(ModelSpec.model_validate(payload))
    if method == "fit":
        return fit_trace(FitRequest.model_validate(payload))
    if method == "suggest_bounds":
        return suggest_bounds(BoundsSuggestionRequest.model_validate(payload))
    if method == "generate_synthetic_trace":
        request = SyntheticTraceRequest.model_validate(payload)
        return generate_synthetic_trace(
            model=request.model,
            voltage_start=request.voltage_start,
            voltage_stop=request.voltage_stop,
            voltage_step=request.voltage_step,
            noise_config=request.noise_config,
            artifact_config=request.artifact_config,
            trace_name=request.trace_name,
            seed=request.seed,
        )
    if method == "import_csv_text_multi":
        request = ImportCsvTextRequest.model_validate(payload)
        return _multi_import_response(import_csv_text_multi(request))
    if method == "export_report":
        result = FitResult.model_validate(payload)
        return {"markdown": fit_result_markdown(result)}
    if method == "export_report_csv":
        result = FitResult.model_validate(payload)
        return {"text": report_csv_text(result)}
    raise ValueError(f"Unsupported browser bridge method: {method}")


def call_json(method: str, payload_json: str | None = None) -> str:
    """Dispatch one browser-runtime operation and return strict JSON text."""
    payload = json.loads(payload_json) if payload_json else None
    result = _dispatch(method, payload)
    return json.dumps(_json_safe(result), ensure_ascii=False, allow_nan=False)
