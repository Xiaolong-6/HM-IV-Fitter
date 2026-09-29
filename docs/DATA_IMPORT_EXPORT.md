# Data import and export policy

The Web UI must make data handling transparent before fitting while keeping the user-facing Import page compact.

## Current Import page behavior

The Import page is a single-column, webpage-style flow:

1. **Import data** — upload, paste, or load sample data.
2. **Trace selection** — shown only after at least one trace is loaded.
3. **Plot review** — shown only after at least one trace is loaded.
4. **Spreadsheet preview** — shown only after at least one trace is loaded.

When no data is loaded, only the Import data card is shown. After import/parse, the Import data card collapses into a compact loaded-data summary but remains re-expandable so the user can import another file or paste new data.

Trace selection should stay compact. Do not reintroduce a separate visible Import quality card or repeated row/column summaries in the main Import page. Detailed import/parser metadata may remain in trace metadata or exported archival files.

## Trace naming and units

Loaded traces can be selected from the Trace selection card. The selected trace name is editable; changes should commit on blur or Enter and should not crash the Import page.

Data workspace unit selectors describe the imported voltage/current column units. Changing them rescales the selected trace to SI units, so preview, plots, and fitting all use V and A internally.

Each imported trace should have safe default metadata when the importer does not provide explicit units:

- `voltage_unit: "V"`
- `voltage_unit_factor_to_V: 1`
- `current_unit: "A"`
- `current_unit_factor_to_A: 1`
- `unit_mode: "si_internal"`

## Spreadsheet preview

Spreadsheet preview should show all loaded traces, not only the selected trace. The currently selected trace should be visually highlighted.

For very large datasets, prefer an explicit preview/virtualization strategy rather than rendering hidden or duplicate panes. Do not let the Import page go blank after loading data.

## File selection

The Import CSV/TXT action uses the browser-native file picker. The browser reads the selected CSV/TXT/DAT file locally and passes its text through the same import/parser pipeline used by paste import and browser-runtime tests.

## Plain CSV/TXT formats

Single-trace files can use one voltage-like column and one current-like column:

```csv
Voltage_V,Current_A
0,0
1,1e-9
```

Current-density columns are also accepted and kept as imported y-values, with additive metadata such as `y_quantity: current_density` and `y_unit: mA/cm2`:

```csv
Voltage_V,Current_density_mAcm2
0,0
1,12.3
```

Wide publication/demo files can use one voltage column followed by multiple current or current-density columns. Each detected current/current-density column becomes a separate imported trace:

```csv
Voltage_V,Fig2c_single_J_mAcm2,Fig3b_planar_J_mAcm2,Fig3b_nano_J_mAcm2
0,0,0,0
0.5,1.1,2.2,3.3
1.0,1.4,2.5,3.6
```

Long publication/demo files can use a trace/group column. Each group becomes one imported trace:

```csv
Trace,Voltage_V,Current_A
single,0,0
single,1,1e-9
planar,0,0
planar,1,2e-9
```

For wide and long files, invalid rows are dropped per trace. Summary columns such as PCE, FF, Voc, Jsc, time, wavelength, and EQE are ignored during current-trace detection.

## Synthetic/debug data

Synthetic trace generation is a debugging and validation aid, not a normal Import-page requirement. Keep synthetic generation out of the main Import-page UI unless the user explicitly asks to reintroduce it.

Synthetic metadata, when used by a debug tool, should remain additive and stored under trace metadata. Synthetic recovery does not prove that the same model is physically correct for a real device.

## HappyMeasure compatibility

IV-fitter should import HappyMeasure CSV v2 exports:

- `single-v2` single trace;
- `combined-v2 / wide-v2` shared-axis multi-trace files;
- `combined-v2 / long-v2` heterogeneous-axis multi-trace files.

HappyMeasure voltage-source exports use `Voltage_V, Current_A`. HappyMeasure current-source exports use `Current_A, Voltage_V`; IV-fitter must still convert them to internal `voltage_V` and `current_A` arrays correctly.

## Example data organization

- `examples/demo_data/iv_traces/` contains user-facing demo IV traces.
- `examples/demo_data/publication_data/` is reserved for publication-derived CSV files with citation/license metadata.
- `examples/synthetic_data/` is for generated synthetic examples.
- `examples/parser_fixtures/` is for internal parser/dev fixtures and should not be presented as user-facing demo data.

Publication-derived CSV files should include citation and license notes, ideally as sidecar metadata:

```text
example_trace.csv
example_trace.meta.json
```

Suggested `.meta.json` fields are `title`, `source`, `citation`, `license`, and `notes`.

## Export requirements

A reproducible fit export must include:

- input trace metadata and parser/import summary;
- exact `ModelSpec`;
- exact `FitConfig`;
- fitted parameters and bounds;
- metrics, warnings, equations, and software version;
- curve arrays sufficient to redraw plots.

Parameter CSV export is a convenience view. JSON is the archival format.
