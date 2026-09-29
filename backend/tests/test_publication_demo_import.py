from pathlib import Path

from fastapi.testclient import TestClient

from ivfitter.api.main import app
from ivfitter.io.import_trace import ImportCsvTextRequest, import_csv_text_multi


def _import(text: str):
    return import_csv_text_multi(ImportCsvTextRequest(text=text, trace_id="demo.csv", delimiter=","))


def test_single_trace_voltage_current_imports_one_trace():
    traces = _import("Voltage_V,Current_A\n0,0\n1,1e-9\n2,2e-9\n")

    trace, quality = traces[0]
    assert len(traces) == 1
    assert trace.voltage_V == [0.0, 1.0, 2.0]
    assert trace.current_A == [0.0, 1e-9, 2e-9]
    assert quality.voltage_col == "Voltage_V"
    assert quality.current_col == "Current_A"
    assert trace.metadata["y_quantity"] == "current"
    assert trace.metadata["y_unit"] == "A"


def test_wide_publication_current_density_columns_import_as_traces():
    text = (
        "Voltage_V,Fig2c_single_J_mAcm2,Fig3b_planar_J_mAcm2,Fig3b_nano_J_mAcm2\n"
        "0,0,0,0\n"
        "0.5,1.1,2.2,3.3\n"
        "1.0,1.4,2.5,3.6\n"
    )

    traces = _import(text)

    assert len(traces) == 3
    assert [trace.trace_id for trace, _quality in traces] == [
        "Fig2c single J mAcm2",
        "Fig3b planar J mAcm2",
        "Fig3b nano J mAcm2",
    ]
    for trace, quality in traces:
        assert trace.voltage_V == [0.0, 0.5, 1.0]
        assert trace.metadata["y_quantity"] == "current_density"
        assert trace.metadata["y_unit"] == "mA/cm2"
        assert quality.rows_imported == 3
        assert "Detected one voltage column and 3 current/current-density columns" in quality.warnings[0]


def test_wide_publication_import_drops_invalid_rows_per_trace():
    text = (
        "Voltage_V,A_J_mAcm2,B_J_mAcm2,C_J_mAcm2\n"
        "0,0,0,\n"
        "0.5,1,,3\n"
        "1.0,,2,4\n"
    )

    traces = _import(text)

    assert len(traces) == 3
    by_name = {trace.trace_id: (trace, quality) for trace, quality in traces}
    assert by_name["A J mAcm2"][0].voltage_V == [0.0, 0.5]
    assert by_name["B J mAcm2"][0].voltage_V == [0.0, 1.0]
    assert by_name["C J mAcm2"][0].voltage_V == [0.5, 1.0]
    assert by_name["A J mAcm2"][1].rows_dropped == 1
    assert by_name["B J mAcm2"][1].rows_dropped == 1
    assert by_name["C J mAcm2"][1].rows_dropped == 1


def test_long_publication_import_groups_by_trace_column():
    text = (
        "Trace,Voltage_V,Current_A\n"
        "single,0,0\n"
        "single,1,1e-9\n"
        "planar,0,0\n"
        "planar,1,2e-9\n"
    )

    traces = _import(text)

    assert len(traces) == 2
    assert [trace.trace_id for trace, _quality in traces] == ["single", "planar"]
    assert traces[0][0].current_A == [0.0, 1e-9]
    assert traces[1][0].current_A == [0.0, 2e-9]
    assert traces[0][0].metadata["format"] == "plain-long"


def test_wide_publication_import_ignores_summary_non_iv_columns():
    text = (
        "Voltage_V,Fig2_J_mAcm2,Fig3_J_mAcm2,PCE,FF,Voc,Jsc,time_s,wavelength_nm\n"
        "0,0,0,12,0.8,1.1,20,0,500\n"
        "1,1,2,12,0.8,1.1,20,1,600\n"
    )

    traces = _import(text)

    assert len(traces) == 2
    assert [trace.trace_id for trace, _quality in traces] == ["Fig2 J mAcm2", "Fig3 J mAcm2"]


def test_wide_import_pairs_multiple_voltage_columns_when_possible():
    text = (
        "Voltage_V,Device_A_Current_A,Bias_V,Device_B_Current_A\n"
        "0,0,0,0\n"
        "1,1e-9,2,2e-9\n"
    )

    traces = _import(text)

    assert len(traces) == 2
    assert traces[0][0].trace_id == "Device A Current A"
    assert traces[0][0].voltage_V == [0.0, 1.0]
    assert traces[1][0].trace_id == "Device B Current A"
    assert traces[1][0].voltage_V == [0.0, 2.0]
    assert traces[0][0].metadata["import_summary"] == "Imported 2 traces from paired voltage/current columns."


def test_wide_publication_import_treats_prefixed_j_a_as_ampere_current():
    text = (
        "1.Dark.Voltage_V,1.Dark.J_A,2.Illumination.Voltage_V,2.Illumination.J_A\n"
        "2,0.05273,2,0.06813\n"
        "1.973,0.05022,1.973,0.06513\n"
    )

    traces = _import(text)

    assert len(traces) == 2
    assert traces[0][0].trace_id == "1.Dark.J A"
    assert traces[1][0].trace_id == "2.Illumination.J A"
    assert traces[0][0].metadata["y_quantity"] == "current"
    assert traces[0][0].metadata["y_unit"] == "A"
    assert traces[0][0].voltage_V == [2.0, 1.973]
    assert traces[1][0].current_A == [0.06813, 0.06513]


def test_real_kadowaki_publication_file_imports_as_ampere_current():
    root = Path(__file__).resolve().parents[2]
    source = root / "examples" / "demo_data" / "publication_data" / "T_Kadowaki_et_al_2025.csv"
    traces = _import(source.read_text(encoding="utf-8"))

    assert len(traces) == 2
    dark, dark_quality = traces[0]
    illuminated, illuminated_quality = traces[1]
    assert dark.trace_id == "1.Dark.J A"
    assert illuminated.trace_id == "2.Illumination.J A"
    assert dark.metadata["y_quantity"] == "current"
    assert dark.metadata["y_unit"] == "A"
    assert illuminated.metadata["y_quantity"] == "current"
    assert illuminated.metadata["y_unit"] == "A"
    assert dark_quality.rows_imported > 100
    assert illuminated_quality.rows_imported == dark_quality.rows_imported


def test_import_api_returns_multi_trace_summary():
    response = TestClient(app).post(
        "/api/import-csv-text-multi",
        json={
            "trace_id": "publication.csv",
            "delimiter": ",",
            "text": "Voltage_V,A_J_mAcm2,B_J_mAcm2,C_J_mAcm2\n0,0,0,0\n1,1,2,3\n",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["traces"]) == 3
    assert payload["summary"] == "Imported 3 traces from one voltage column."
    assert payload["warnings"]
