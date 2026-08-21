#!/usr/bin/env node
/**
 * esbuild 单文件打包脚本
 * 产物：dist-bundle/nseap-mcp.mjs（自包含，无 node_modules 依赖，可直接
 * `node dist-bundle/nseap-mcp.mjs` 运行）——M1 分发用（CogSeed 连接器
 * command 直接指向该文件，无需 Node 项目环境）。
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist-bundle/nseap-mcp.mjs",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
  minify: false,
  // MCP SDK 依赖动态 import 的 JSON，保留外部包会破坏 bundle；
  // 全部打进来（自包含优先）
  packages: "bundle",
  logLevel: "info",
});

console.log("✅ dist-bundle/nseap-mcp.mjs 打包完成（自包含单文件）");
