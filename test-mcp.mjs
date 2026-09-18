import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function run() {
  const transport = new SSEClientTransport(
    new URL("http://localhost:3000/mcp")
  );
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  console.log("Connecting to MCP via SSE...");
  await client.connect(transport);
  console.log("Connected!");

  // List tools
  const tools = await client.listTools();
  console.log(`Available tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  console.log("\nSearching for 'Polgári Törvénykönyv fogyasztóvédelem irányelv'...");
  const searchRes = await client.callTool({
    name: "search_legislation",
    arguments: {
      query: "Polgári Törvénykönyv fogyasztóvédelem",
      limit: 3
    },
  });

  console.log("Search Result:");
  console.dir(searchRes.content, { depth: null });
  
  process.exit(0);
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
