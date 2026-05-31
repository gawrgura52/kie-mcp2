import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */
const KIE_API_KEY = process.env.KIE_API_KEY || "";
const MCP_SECRET  = process.env.MCP_SECRET  || "";
const KIE_BASE    = "https://api.kie.ai";
const PORT        = process.env.PORT || 8080;

/* Curated catalog with EXACT kie.ai model ids + real input fields.
   Any other kie.ai model id also works via create_task — this is just
   the documented shortlist (verified against docs.kie.ai). */
const CATALOG = {
  // ---------- IMAGE ----------
  "nano-banana-2": {
    kind: "image",
    name: "Nano Banana Pro (Google) — flagship image / image-to-image",
    input: {
      prompt: "string (required)",
      image_input: "string[] — reference/style image URLs; omit or [] for pure text-to-image",
      aspect_ratio: "auto | 9:16 | 1:1 | 16:9 | 3:4 | 4:3",
      resolution: "1K | 2K | 4K",
      output_format: "png | jpeg",
    },
    example: { prompt: "<scene>", image_input: [], aspect_ratio: "9:16", resolution: "2K", output_format: "png" },
  },
  "gpt-image-2-text-to-image": {
    kind: "image",
    name: "GPT Image 2 — text to image",
    input: { prompt: "string (required)", aspect_ratio: "auto | 9:16 | 1:1 | 16:9 | 3:4" },
    example: { prompt: "<scene>", aspect_ratio: "9:16" },
  },

  // ---------- VIDEO ----------
  "kling-3.0/video": {
    kind: "video",
    name: "Kling 3.0 — text/image to video; multi-shot, elements, sound",
    input: {
      prompt: "string (single-shot). For multi-shot set multi_shots:true and use multi_prompt.",
      image_urls: "string[] — [firstFrame] or [firstFrame,lastFrame]; if set, aspect_ratio optional",
      aspect_ratio: "16:9 | 9:16 | 1:1",
      duration: "string seconds '3'..'15' (e.g. '5')",
      mode: "std | pro | 4K",
      sound: "boolean (sound effects)",
      multi_shots: "boolean",
      multi_prompt: "[{prompt, duration}] when multi_shots:true (1-12s each, <=500 chars)",
      kling_elements: "[{name, description, element_input_urls:[2-4 urls]}] — reference with @name in prompt",
    },
    example: { prompt: "neon ramen shop at night, slow dolly-in", aspect_ratio: "9:16", duration: "5", mode: "pro", sound: true },
  },
  "bytedance/seedance-1.5-pro": {
    kind: "video",
    name: "Seedance 1.5 Pro — text/image to video; dynamic camera, optional audio",
    input: {
      prompt: "string (required)",
      input_urls: "string[] — 0-2 image URLs for image-to-video (omit for text-to-video)",
      aspect_ratio: "9:16 | 1:1 | 16:9 | 3:4",
      resolution: "720p | 1080p",
      duration: "string seconds (e.g. '8')",
      fixed_lens: "boolean (lock lens for stable shots)",
      generate_audio: "boolean (costs more)",
      nsfw_checker: "boolean",
    },
    example: { prompt: "<scene + action>", input_urls: [], aspect_ratio: "9:16", resolution: "1080p", duration: "8", generate_audio: false },
  },
  "bytedance/seedance-2": {
    kind: "video",
    name: "Seedance 2.0 — text/image to video with multimodal references",
    input: {
      prompt: "string (required)",
      first_frame_url: "string — optional first frame image",
      last_frame_url: "string — optional last frame image",
      reference_image_urls: "string[] — optional reference images",
      resolution: "string (e.g. 720p | 1080p)",
      generate_audio: "boolean",
    },
    example: { prompt: "<scene + action>", first_frame_url: "", generate_audio: false },
  },
};

/* ------------------------------------------------------------------ */
/* kie.ai helpers                                                      */
/* ------------------------------------------------------------------ */
async function kieCreate(model, input) {
  if (!KIE_API_KEY) throw new Error("Server is missing KIE_API_KEY.");
  const r = await fetch(KIE_BASE + "/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: "Bearer " + KIE_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  const txt = await r.text();
  let data = {}; try { data = JSON.parse(txt); } catch {}
  if (!r.ok || (data.code && data.code !== 200)) {
    throw new Error(`createTask failed (${r.status}/${data.code ?? "?"}): ${(data.msg || data.message || txt).toString().slice(0, 300)}`);
  }
  const taskId = data?.data?.taskId;
  if (!taskId) throw new Error("No taskId returned: " + txt.slice(0, 300));
  return taskId;
}

async function kieRecord(taskId) {
  const r = await fetch(KIE_BASE + "/api/v1/jobs/recordInfo?taskId=" + encodeURIComponent(taskId), {
    headers: { Authorization: "Bearer " + KIE_API_KEY },
  });
  if (!r.ok) throw new Error(`recordInfo ${r.status}`);
  const data = await r.json();
  return data?.data || {};
}

function extractUrls(rec) {
  let rj = rec.resultJson;
  if (!rj) return [];
  if (typeof rj === "string") { try { rj = JSON.parse(rj); } catch { return []; } }
  return rj.resultUrls || rj.result_urls || [];
}

const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const asErr  = (msg) => ({ content: [{ type: "text", text: "ERROR: " + msg }], isError: true });

/* ------------------------------------------------------------------ */
/* MCP server + tools                                                  */
/* ------------------------------------------------------------------ */
function buildServer() {
  const server = new McpServer({ name: "kie-ai", version: "2.0.0" });

  server.tool(
    "list_models",
    "List kie.ai models with their EXACT model ids and input field schemas. Read this before generating so you pass the correct model id and input shape. NOTE: any other kie.ai model id also works with create_task — this catalog is just the documented shortlist.",
    {},
    async () => asText({
      models: CATALOG,
      note: "Pass the model id (the catalog key) and a matching 'input' object to create_task. Any other kie.ai market model id is also accepted.",
    })
  );

  server.tool(
    "create_task",
    "Start a generation on kie.ai (image OR video). Returns a task_id immediately — it does NOT wait. After calling, call check_status(task_id) every ~5-10 seconds until state is 'success', then show the user the result URL. Use list_models for exact model ids and input fields. 'input' is the kie.ai input object for that model.",
    {
      model: z.string().describe("Exact kie.ai model id, e.g. 'nano-banana-2', 'kling-3.0/video', 'bytedance/seedance-1.5-pro'."),
      input: z.record(z.any()).describe("The kie.ai 'input' object for this model (prompt + model-specific fields). See list_models."),
    },
    async ({ model, input }) => {
      try {
        const taskId = await kieCreate(model, input);
        return asText({ task_id: taskId, model, next: "Call check_status(task_id) every ~5-10s until state is 'success'." });
      } catch (e) { return asErr(e.message); }
    }
  );

  server.tool(
    "check_status",
    "Check a kie.ai task by task_id. While state is waiting/queuing/generating, wait a few seconds and call again. When state is 'success', the result URL(s) are returned (image or video). When 'fail', an error is returned.",
    { task_id: z.string().describe("task_id returned by create_task.") },
    async ({ task_id }) => {
      try {
        const rec = await kieRecord(task_id);
        const state = rec.state;
        if (state === "success") {
          const urls = extractUrls(rec);
          const url = urls[0] || null;
          const isVideo = url ? /\.(mp4|webm|mov)(\?|$)/i.test(url) : false;
          return asText({ state, result_urls: urls, [isVideo ? "video_url" : "image_url"]: url, credits_used: rec.creditsConsumed });
        }
        if (state === "fail" || state === "failed" || state === "error") {
          return asText({ state, error: rec.failMsg || "Generation failed." });
        }
        return asText({ state, progress: rec.progress ?? null, note: "Not done yet — wait a few seconds and call check_status again." });
      } catch (e) { return asErr(e.message); }
    }
  );

  return server;
}

/* ------------------------------------------------------------------ */
/* HTTP (stateless Streamable HTTP, secret-gated path)                 */
/* ------------------------------------------------------------------ */
const app = express();
app.use(express.json({ limit: "6mb" }));

app.get("/", (_req, res) => res.send("kie.ai MCP server is running. Add /<your-secret>/mcp to Claude as a custom connector."));

function checkSecret(req, res) {
  if (!MCP_SECRET || req.params.secret !== MCP_SECRET) { res.status(404).end(); return false; }
  return true;
}

app.post("/:secret/mcp", async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error: " + e.message }, id: null });
  }
});

const methodNotAllowed = (req, res) => {
  if (!checkSecret(req, res)) return;
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get("/:secret/mcp", methodNotAllowed);
app.delete("/:secret/mcp", methodNotAllowed);

app.listen(PORT, () => console.log(`kie.ai MCP server listening on :${PORT}`));
