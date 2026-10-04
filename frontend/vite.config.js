import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import fs from "node:fs";
import path from "node:path";

const certificatesDirectory = path.resolve("certs");
const certificateKey = path.join(certificatesDirectory, "local-key.pem");
const certificateFile = path.join(certificatesDirectory, "local.pem");
export default defineConfig(({ mode }) => {
  const useHttps = loadEnv(mode, ".", "").HTTPS === "true";

  if (
    useHttps &&
    (!fs.existsSync(certificateKey) || !fs.existsSync(certificateFile))
  ) {
    throw new Error(
      "Certificados HTTPS ausentes. Gere certs/local.pem e certs/local-key.pem com mkcert.",
    );
  }

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      ...(useHttps
        ? {
            https: {
              key: fs.readFileSync(certificateKey),
              cert: fs.readFileSync(certificateFile),
            },
          }
        : {}),
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3000",
          changeOrigin: true,
          secure: false,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
        },
      },
    },
  };
});
