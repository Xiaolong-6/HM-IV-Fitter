import { expect, test } from "@playwright/test";

test.setTimeout(180_000);

test("static browser runtime imports, fits, and exports without FastAPI", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.locator("#root")).toBeVisible();

  const result = await page.evaluate(async () => {
    const worker = new Worker(
      new URL("browser-runtime.worker.js", window.location.href),
      { type: "module" },
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
  expect(Math.abs((result.fittedResistance ?? 0) - 1000)).toBeLessThan(0.1);
  expect(result.fittedPoints).toBe(5);
  expect(result.reportHeading).toBe(true);
});


test("static UI uses four-step workflow and imports bundled HappyMeasure sample", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("http://127.0.0.1:4173/");

  const workflow = page.getByRole("navigation", { name: "Analysis workflow" });
  await expect(workflow.getByRole("button", { name: "1 Import data" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(workflow.getByRole("button", { name: "2 Model builder" })).toBeVisible();
  await expect(workflow.getByRole("button", { name: "3 Fit" })).toBeVisible();
  await expect(workflow.getByRole("button", { name: "4 Report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Help" })).toHaveCount(0);
  await expect(page.locator(".workflow-top-utilities")).toHaveCount(0);
  await expect(page.locator(".workflow-language-control")).toHaveCount(0);
  await expect(page.locator(".workflow-zoom-control")).toHaveCount(0);
  await expect(page.locator(".workflow-version")).toHaveCount(0);

  await workflow.getByRole("button", { name: "4 Report" }).click();
  await expect(page.getByText("No completed fit yet.")).toBeVisible();
  await expect(page.getByText("No critical issue detected")).toHaveCount(0);
  await expect(page.getByText("Warnings and diagnostics")).toHaveCount(0);
  await workflow.getByRole("button", { name: "1 Import data" }).click();

  await page.getByRole("button", { name: "Sample data" }).click();
  await page.getByRole("button", { name: "Load sample data" }).click();

  await expect(
    page.getByText(/Sample HappyMeasure data loaded\. \(14 traces\)/),
  ).toBeVisible({ timeout: 180_000 });
  const importSummary = page.getByRole("region", { name: "Import summary" });
  await expect(importSummary.getByText(/14 traces · 1330 points/)).toBeVisible();

  await page.screenshot({
    path: "test-results/four-step-import.png",
    fullPage: true,
  });

  await workflow.getByRole("button", { name: "3 Fit" }).click();
  await expect(page.locator(".fitting-page-one-column")).toBeVisible();
  const emptyRunFit = page.getByRole("button", { name: "Run fit" });
  await expect(emptyRunFit).toBeDisabled();
  await expect(page.getByText("No runnable model.")).toBeVisible();

  await workflow.getByRole("button", { name: "2 Model builder" }).click();
  await expect(page.locator(".mbv3-direct-page")).toBeVisible();
  await page.getByRole("button", { name: "Model presets" }).click();
  await page.getByText("Single diode model", { exact: true }).click();
  const useModel = page.getByRole("button", { name: "Use model for fitting" });
  await expect(useModel).toBeEnabled();
  await page.screenshot({
    path: "test-results/four-step-model.png",
    fullPage: true,
  });
  await useModel.click();

  await expect(page.locator(".fitting-page-one-column")).toBeVisible();
  const runFit = page.getByRole("button", { name: "Run fit" });
  await expect(runFit).toBeEnabled();
  await page.screenshot({
    path: "test-results/four-step-fit.png",
    fullPage: true,
  });

  await workflow.getByRole("button", { name: "4 Report" }).click();
  await expect(page.locator(".scientific-report-page")).toBeVisible();
  await expect(page.getByText("No completed fit yet.")).toBeVisible();
  await page.screenshot({
    path: "test-results/four-step-report.png",
    fullPage: true,
  });

  await workflow.getByRole("button", { name: "3 Fit" }).click();
  await runFit.click();
  const stopFit = page.getByRole("button", { name: "Stop fit" });
  await expect(stopFit).toBeVisible();
  await stopFit.click();
  await expect(page.getByRole("button", { name: "Run fit" })).toBeVisible();
  await expect(page.getByText(/Cancelled ·/)).toBeVisible();

  await page.getByRole("button", { name: "Run fit" }).click();
  await expect(page.getByRole("button", { name: "Run again" })).toBeVisible({
    timeout: 120_000,
  });

  const traceSelect = page.locator(".plot-trace-select select");
  await expect(traceSelect.locator("option")).toHaveCount(14);
  const originalTrace = await traceSelect.inputValue();
  const options = await traceSelect.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLOptionElement).value),
  );
  const replacementTrace = options.find((value) => value !== originalTrace);
  expect(replacementTrace).toBeTruthy();
  await traceSelect.selectOption(replacementTrace!);

  await expect(page.getByRole("button", { name: "Run fit" })).toBeVisible();
  await workflow.getByRole("button", { name: "4 Report" }).click();
  await expect(page.getByText("No completed fit yet.")).toBeVisible();
  await expect(page.getByText("No critical issue detected")).toHaveCount(0);
});

test("static UI reports browser runtime bootstrap failure and offers retry", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/pyodide/**", async (route) => {
    await route.abort("failed");
  });

  await page.goto("http://127.0.0.1:4173/");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Local fitting engine failed to start", {
    timeout: 30_000,
  });
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
});
