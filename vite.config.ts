import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf-8"));

function staticPythonPayloadPlugin(enabled: boolean): Plugin {
  return {
    name: "ivfitter-static-python-payload",
    apply: "build",
    closeBundle() {
      if (!enabled) return;

      const sourceRoot = join(here, "backend", "ivfitter");
      const outputRoot = join(here, "frontend", "dist", "static-python");
      const files: string[] = [];

      function copyPythonTree(directory: string) {
        for (const entry of readdirSync(directory)) {
          if (entry === "__pycache__") continue;
          const sourcePath = join(directory, entry);
          const info = statSync(sourcePath);
          if (info.isDirectory()) {
            copyPythonTree(sourcePath);
            continue;
          }
          if (!entry.endsWith(".py")) continue;

          const rel = join("ivfitter", relative(sourceRoot, sourcePath));
          const normalized = rel.replaceAll("\\", "/");
          const targetPath = join(outputRoot, rel);
          mkdirSync(dirname(targetPath), { recursive: true });
          copyFileSync(sourcePath, targetPath);
          files.push(normalized);
        }
      }

      mkdirSync(outputRoot, { recursive: true });
      copyPythonTree(sourceRoot);
      files.sort();
      writeFileSync(
        join(outputRoot, "manifest.json"),
        JSON.stringify(
          {
            app_version: pkg.version,
            pyodide_version: "314.0.7",
            files,
          },
          null,
          2,
        ),
        "utf-8",
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const staticBrowser = mode === "static";

  return {
    root: "frontend",
    base: staticBrowser ? "./" : "/",
    plugins: [react(), staticPythonPayloadPlugin(staticBrowser)],
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": join(here, "frontend", "src"),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
