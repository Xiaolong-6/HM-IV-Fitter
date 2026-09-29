from pathlib import Path

from ivfitter.io.import_trace import ImportCsvTextRequest, import_csv_text_multi


def test_demo_iv_trace_folder_exists():
    root = Path(__file__).resolve().parents[2]
    folder = root / "examples" / "demo_data" / "iv_traces"
    assert folder.is_dir()
    assert (folder / "minimal_demo_iv.csv").is_file()


def test_demo_iv_trace_uses_existing_parser_pipeline():
    root = Path(__file__).resolve().parents[2]
    demo = root / "examples" / "demo_data" / "iv_traces" / "minimal_demo_iv.csv"
    traces = import_csv_text_multi(
        ImportCsvTextRequest(text=demo.read_text(), trace_id=demo.name)
    )
    assert len(traces) == 1
    trace, quality = traces[0]
    assert len(trace.voltage_V) == len(trace.current_A) == 7
    assert quality.rows_imported == 7
