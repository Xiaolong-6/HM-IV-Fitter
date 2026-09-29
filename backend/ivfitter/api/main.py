"""FastAPI application for the greenfield IV-fitter backend."""

from __future__ import annotations
import hmac
import logging
import os
import threading
import time
from contextlib import contextmanager
from typing import NoReturn

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError

from ivfitter import __version__
from ivfitter.core.component_registry import component_registry
from ivfitter.core.equations import generate_equations
from ivfitter.core.topology_graph import assemble_graph, graph_text_summary
from ivfitter.core.fitting_engine import fit_trace
from ivfitter.core.model_spec import FitRequest, FitWarning, FitResult, ModelSpec
from ivfitter.core.bounds_suggestion import BoundsSuggestionRequest, BoundsSuggestionResponse, suggest_bounds
from ivfitter.core.synthetic_trace import SyntheticTraceRequest, SyntheticTraceResult, generate_synthetic_trace
from ivfitter.core.model_validation import validate_model_spec
from ivfitter.io.export_report import fit_result_markdown
from ivfitter.io.import_trace import ImportCsvTextRequest, import_csv_text, import_csv_text_multi
from ivfitter.io.export_result import fit_result_json_text, report_csv_text


app = FastAPI(title="IV-fitter Web Backend", version=__version__)
LOGGER = logging.getLogger(__name__)


def _cors_origins() -> list[str]:
    raw = os.getenv("IVFITTER_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    validated: list[str] = []
    for origin in origins:
        if origin == "*":
            LOGGER.warning("CORS wildcard '*' is not allowed; ignoring unsafe origin.")
            continue
        if not origin.startswith(("http://", "https://")):
            LOGGER.warning("CORS origin %r does not start with http:// or https://; ignoring.", origin)
            continue
        validated.append(origin)
    return validated or ["http://127.0.0.1:5173", "http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-IVFITTER-API-Key"],
)

def _api_token() -> str | None:
    token = os.getenv("IVFITTER_API_TOKEN", "").strip()
    return token or None


def _debug_errors_enabled() -> bool:
    return os.getenv("IVFITTER_DEBUG_ERRORS", "").strip().lower() in {"1", "true", "yes", "on"}


def _raise_internal_error(exc: Exception, context: str) -> NoReturn:
    LOGGER.exception("%s", context)
    detail = str(exc) if _debug_errors_enabled() else "Internal server error. See backend log for details."
    raise HTTPException(status_code=500, detail=detail) from exc




@app.middleware("http")
async def require_api_token_when_configured(request: Request, call_next):
    """Require a simple API token only when IVFITTER_API_TOKEN is configured.

    Local development remains frictionless by default. LAN/dev launchers can
    set IVFITTER_API_TOKEN and the frontend sends the same value
    as X-IVFITTER-API-Key. Health/version remain open for diagnostics.
    """
    token = _api_token()
    if token and request.method.upper() != "OPTIONS" and request.url.path not in {"/api/health", "/api/version", "/api/v2/health", "/api/v2/version"}:
        supplied = request.headers.get("X-IVFITTER-API-Key", "")
        if not hmac.compare_digest(supplied, token):
            return JSONResponse(status_code=401, content={"detail": "Missing or invalid IV-fitter API token."})
    return await call_next(request)


MAX_IMPORT_TEXT_CHARS = int(os.getenv("IVFITTER_MAX_IMPORT_TEXT_CHARS", "5000000"))
MAX_FIT_POINTS = int(os.getenv("IVFITTER_MAX_FIT_POINTS", "50000"))
MAX_CONCURRENT_CPU_REQUESTS = max(1, int(os.getenv("IVFITTER_MAX_CONCURRENT_FITS", "2")))
_CPU_SEMAPHORE = threading.BoundedSemaphore(MAX_CONCURRENT_CPU_REQUESTS)
_RATE_LIMIT_LOCK = threading.Lock()
_RATE_LIMIT_BUCKETS: dict[str, tuple[float, float]] = {}
_RATE_LIMIT_CLEANUP_INTERVAL = 300.0
_RATE_LIMIT_LAST_CLEANUP: float = 0.0


@contextmanager
def _cpu_endpoint_slot(endpoint_label: str):
    """Bound local CPU-heavy endpoints so accidental multi-clicks cannot saturate the host."""
    acquired = _CPU_SEMAPHORE.acquire(blocking=False)
    if not acquired:
        raise HTTPException(
            status_code=503,
            detail=f"{endpoint_label} is busy. Try again after the current compute job finishes.",
            headers={"Retry-After": "2"},
        )
    try:
        yield
    finally:
        _CPU_SEMAPHORE.release()


def _rate_limit_per_minute() -> int:
    try:
        return max(0, int(os.getenv("IVFITTER_RATE_LIMIT_PER_MIN", "600")))
    except ValueError:
        return 600


@app.middleware("http")
async def local_rate_limit_guard(request: Request, call_next):
    """Lightweight token-bucket guard for runaway local/LAN automation.

    Set IVFITTER_RATE_LIMIT_PER_MIN=0 to disable. Health/version and CORS
    preflight remain unthrottled for diagnostics and browser startup.
    """
    if request.method.upper() == "OPTIONS" or request.url.path in {"/api/health", "/api/version", "/api/v2/health", "/api/v2/version"}:
        return await call_next(request)
    limit = _rate_limit_per_minute()
    if limit <= 0:
        return await call_next(request)
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    capacity = float(limit)
    refill_per_s = capacity / 60.0
    global _RATE_LIMIT_LAST_CLEANUP
    with _RATE_LIMIT_LOCK:
        if now - _RATE_LIMIT_LAST_CLEANUP > _RATE_LIMIT_CLEANUP_INTERVAL:
            _RATE_LIMIT_LAST_CLEANUP = now
            stale_threshold = now - 600.0
            expired = [k for k, (_, ts) in _RATE_LIMIT_BUCKETS.items() if ts < stale_threshold]
            for k in expired:
                del _RATE_LIMIT_BUCKETS[k]
    with _RATE_LIMIT_LOCK:
        tokens, last_seen = _RATE_LIMIT_BUCKETS.get(key, (capacity, now))
        tokens = min(capacity, tokens + max(0.0, now - last_seen) * refill_per_s)
        if tokens < 1.0:
            retry_after = max(1, int((1.0 - tokens) / refill_per_s) + 1)
            _RATE_LIMIT_BUCKETS[key] = (tokens, now)
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many IV-fitter API requests. Please slow down."},
                headers={"Retry-After": str(retry_after)},
            )
        _RATE_LIMIT_BUCKETS[key] = (tokens - 1.0, now)
    return await call_next(request)

def _check_import_size(text: str) -> None:
    if len(text) > MAX_IMPORT_TEXT_CHARS:
        raise HTTPException(status_code=413, detail=f"CSV text is too large ({len(text)} characters). Limit is {MAX_IMPORT_TEXT_CHARS} characters.")

def _check_fit_size(request: FitRequest) -> None:
    n_v = len(request.trace.voltage_V)
    n_i = len(request.trace.current_A)
    if max(n_v, n_i) > MAX_FIT_POINTS:
        raise HTTPException(status_code=413, detail=f"Trace has too many points ({max(n_v, n_i)}). Limit is {MAX_FIT_POINTS} points.")


class ReportResponse(BaseModel):
    markdown: str

# Canonical public API routes use /api/v2/. The bare /api/ aliases below are
# retained for backward compatibility with pre-v2 local clients and scripts; keep
# both decorators together until ROADMAP.md declares that legacy clients can be
# dropped.

@app.get("/api/v2/health")
@app.get("/api/health")
def health() -> dict[str, str]:
    """Return service health."""
    return {"status": "ok"}

@app.get("/api/v2/component-registry")
@app.get("/api/component-registry")
def get_component_registry():
    """Return function-library definitions consumed by the frontend."""
    return component_registry()

@app.post("/api/v2/validate-model")
@app.post("/api/validate-model")
def validate_model(model: ModelSpec) -> list[FitWarning]:
    """Validate a ModelSpec and return physics, schema, and UX warnings."""
    return validate_model_spec(model)

@app.post("/api/v2/equations")
@app.post("/api/equations")
def equations(model: ModelSpec):
    """Return generated equations for a ModelSpec."""
    return generate_equations(model)

@app.post("/api/v2/topology-preview")
@app.post("/api/topology-preview")
def topology_preview(model: ModelSpec):
    """Return user-readable topology graph preview."""
    graph = assemble_graph(model)
    return {"graph": graph, "summary": graph_text_summary(graph)}


@app.post("/api/v2/suggest-bounds", response_model=BoundsSuggestionResponse)
@app.post("/api/suggest-bounds", response_model=BoundsSuggestionResponse)
def suggest_bounds_endpoint(request: BoundsSuggestionRequest) -> BoundsSuggestionResponse:
    """Return conservative data-aware bound suggestions for the selected trace/model."""
    try:
        with _cpu_endpoint_slot("Bounds suggestion"):
            _check_fit_size(FitRequest(trace=request.trace, model=request.model, config=request.config))
            return suggest_bounds(request)
    except Exception as exc:
        _handle_endpoint_error(exc, "Bounds suggestion")

@app.post("/api/v2/generate-synthetic-trace", response_model=SyntheticTraceResult)
@app.post("/api/generate-synthetic-trace", response_model=SyntheticTraceResult)
def generate_synthetic_trace_endpoint(request: SyntheticTraceRequest) -> SyntheticTraceResult:
    """Forward-simulate an IV trace from the supplied ModelSpec."""
    try:
        with _cpu_endpoint_slot("Synthetic trace generation"):
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
    except Exception as exc:
        _handle_endpoint_error(exc, "Synthetic trace generation")

@app.post("/api/v2/fit")
@app.post("/api/fit")
def fit(request: FitRequest):
    """Run one local trace fit."""
    try:
        with _cpu_endpoint_slot("Fit"):
            _check_fit_size(request)
            return fit_trace(request)
    except Exception as exc:
        _handle_endpoint_error(exc, "Fit")

@app.post("/api/v2/export-report", response_model=ReportResponse)
@app.post("/api/export-report", response_model=ReportResponse)
def export_report(result: FitResult) -> ReportResponse:
    """Return a Markdown report for one fit result."""
    return ReportResponse(markdown=fit_result_markdown(result))

class TextResponse(BaseModel):
    text: str

def _multi_import_response(items) -> dict:
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


def _handle_endpoint_error(exc: Exception, context: str) -> NoReturn:
    """Standard error handler for CPU-bound or validation endpoints."""
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, (ValueError, ValidationError)):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _raise_internal_error(exc, context)

@app.post("/api/v2/import-csv-text")
@app.post("/api/import-csv-text")
def import_csv_text_endpoint(payload: ImportCsvTextRequest):
    """Import CSV/TXT text and return TraceData plus import-quality summary."""
    try:
        _check_import_size(payload.text)
        trace, quality = import_csv_text(payload)
        return {"trace": trace, "quality": quality}
    except Exception as exc:
        _handle_endpoint_error(exc, "Import CSV text")

@app.post("/api/v2/import-csv-text-multi")
@app.post("/api/import-csv-text-multi")
def import_csv_text_multi_endpoint(payload: ImportCsvTextRequest):
    """Import plain/HappyMeasure CSV text and return one or more traces."""
    try:
        _check_import_size(payload.text)
        return _multi_import_response(import_csv_text_multi(payload))
    except Exception as exc:
        _handle_endpoint_error(exc, "Import CSV text multi")

@app.post("/api/v2/export-report-csv", response_model=TextResponse)
@app.post("/api/export-report-csv", response_model=TextResponse)
def export_report_csv(result: FitResult) -> TextResponse:
    """Return a sectioned, spreadsheet-friendly fit report CSV."""
    return TextResponse(text=report_csv_text(result))


@app.post("/api/v2/export-result-json", response_model=TextResponse)
@app.post("/api/export-result-json", response_model=TextResponse)
def export_result_json(result: FitResult) -> TextResponse:
    """Return a reproducible FitResult JSON document."""
    return TextResponse(text=fit_result_json_text(result))



@app.get("/api/v2/version")
@app.get("/api/version")
def version() -> dict[str, str]:
    """Return backend version and schema milestone."""
    return {"version": __version__, "schema": "ModelSpec/FitResult law-form-placement + HappyMeasure multi-trace"}
