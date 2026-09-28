import { expect, test } from "@playwright/test";

test.setTimeout(180_000);

test("static browser runtime imports, fits, and exports without FastAPI", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.locator("#root")).toBeVisible();

  const result = await page.evaluate(async () => {
    const worker = new Worker(
      new URL("browser-runtime.worker.js", window.location.href),
    );
    let nextId = 1;

    const call = <T,>(method: string, payload: unknown): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++;

        const onMessage = (event: MessageEvent) => {
          const message = event.data;
          if (message?.id !== id) return;
          worker.removeEventListener("message", onMessage);

          if (message.ok) {
            resolve(message.result as T);
            return;
          }
          reject(new Error(message.error || "Static browser runtime failed."));
        };

        worker.addEventListener("message", onMessage);
        worker.postMessage({
          id,
          method,
          payload,
          baseUrl: new URL("./", window.location.href).toString(),
        });
      });

    const registry = await call<Array<{ function_type: string }>>(
      "component_registry",
      null,
    );

    const imported = await call<{
      traces: Array<{
        trace: {
          voltage_V: number[];
          current_A: number[];
          trace_id: string;
          metadata: Record<string, unknown>;
        };
      }>;
    }>("import_csv_text_multi", {
      text: "Voltage_V,Current_A\n-1,-0.001\n-0.5,-0.0005\n0,0\n0.5,0.0005\n1,0.001\n",
      trace_id: "static-smoke",
    });

    const model = {
      core: [],
      series: [],
      parallel: [
        {
          id: "Rsh",
          location: "parallel",
          function_type: "shunt",
          law_id: "ohmic",
          evaluation_form: "current_branch",
          placement: "parallel_current_branch",
          params: {
            Rsh_ohm: {
              value: 600,
              lower: 1,
              upper: 1e9,
              fit: true,
              unit: "ohm",
            },
          },
        },
      ],
      temperature_K: 300,
      version: "static-browser-smoke",
    };

    const fit = await call<{
      success: boolean;
      parameters: Record<string, { value: number }>;
      curves: { current_fit_A: number[] };
    }>("fit", {
      trace: imported.traces[0].trace,
      model,
      config: {
        weighting: "linear",
        loss: "linear",
        fit_speed: "standard",
        exclude_compliance: false,
        max_nfev: 200,
        multistart_enabled: false,
        run_timeout_s: 0,
        solver_mode: "legacy_composite",
      },
    });

    const report = await call<{ markdown: string }>("export_report", fit);

    worker.terminate();

    return {
      hasDiode: registry.some((item) => item.function_type === "diode"),
      importedPoints: imported.traces[0].trace.voltage_V.length,
      fitSuccess: fit.success,
      fittedResistance: fit.parameters["Rsh.Rsh_ohm"]?.value,
      fittedPoints: fit.curves.current_fit_A.length,
      reportHeading: report.markdown.includes("# IV-fitter Web report"),
    };
  });

  expect(result.hasDiode).toBe(true);
  expect(result.importedPoints).toBe(5);
  expect(result.fitSuccess).toBe(true);
  expect(result.fittedResistance).toBeCloseTo(1000, 3);
  expect(result.fittedPoints).toBe(5);
  expect(result.reportHeading).toBe(true);
});
