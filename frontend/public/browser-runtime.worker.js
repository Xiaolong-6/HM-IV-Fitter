/* Browser-local numerical runtime for the static IV-fitter build.
 *
 * This file is intentionally a classic Worker so Pyodide's CDN loader can be
 * initialized with importScripts. All fitting work stays off the React thread.
 */

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const PYTHON_ROOT = "/opt/ivfitter-static";

let runtimePromise = null;
let bridgeCall = null;
let runtimeBaseUrl = null;

function normalizeBaseUrl(value) {
  const url = new URL(value, self.location.href);
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

function errorMessage(error) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

async function fetchRequired(url, kind) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${kind} request failed (${response.status}): ${url}`);
  }
  return response;
}

async function installProjectSources(pyodide, baseUrl) {
  const manifestUrl = new URL("static-python/manifest.json", baseUrl);
  const manifestResponse = await fetchRequired(manifestUrl, "Python manifest");
  const manifest = await manifestResponse.json();

  if (!manifest || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error("Static Python manifest is missing or empty.");
  }

  pyodide.FS.mkdirTree(PYTHON_ROOT);

  for (const relativePath of manifest.files) {
    const sourceUrl = new URL(`static-python/${relativePath}`, baseUrl);
    const response = await fetchRequired(sourceUrl, "Python source");
    const text = await response.text();
    const targetPath = `${PYTHON_ROOT}/${relativePath}`;
    const slash = targetPath.lastIndexOf("/");
    if (slash > 0) pyodide.FS.mkdirTree(targetPath.slice(0, slash));
    pyodide.FS.writeFile(targetPath, text, { encoding: "utf8" });
  }

  pyodide.runPython(
    `import sys
if "${PYTHON_ROOT}" not in sys.path:
    sys.path.insert(0, "${PYTHON_ROOT}")`
  );

  bridgeCall = pyodide.runPython(
    "from ivfitter.browser_bridge import call_json\ncall_json"
  );
}

async function initializeRuntime(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (runtimePromise) {
    if (runtimeBaseUrl !== normalizedBaseUrl) {
      throw new Error("Browser runtime was initialized with a different static base URL.");
    }
    return runtimePromise;
  }

  runtimeBaseUrl = normalizedBaseUrl;
  runtimePromise = (async () => {
    importScripts(`${PYODIDE_INDEX_URL}pyodide.js`);
    if (typeof loadPyodide !== "function") {
      throw new Error("Pyodide loader did not initialize.");
    }

    const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
    await pyodide.loadPackage(["numpy", "scipy", "pandas", "pydantic"]);
    await installProjectSources(pyodide, normalizedBaseUrl);
    return pyodide;
  })();

  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    runtimeBaseUrl = null;
    bridgeCall = null;
    throw error;
  }
}

self.onmessage = async (event) => {
  const { id, method, payload, baseUrl } = event.data || {};
  if (!id || !method || !baseUrl) return;

  try {
    await initializeRuntime(baseUrl);
    if (!bridgeCall) throw new Error("IV-fitter browser bridge is unavailable.");

    const responseText = bridgeCall(
      String(method),
      JSON.stringify(payload === undefined ? null : payload)
    );
    self.postMessage({
      id,
      ok: true,
      result: JSON.parse(String(responseText)),
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: errorMessage(error),
    });
  }
};
