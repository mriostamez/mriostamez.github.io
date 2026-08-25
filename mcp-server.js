import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSV_FILE = path.join(__dirname, "data.csv");

// Helper to read and parse data.csv
function readCSV() {
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, "Date,Calories,Carbs,Fat,Protein\n", "utf8");
    return {};
  }
  const content = fs.readFileSync(CSV_FILE, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const entries = {};

  if (lines.length <= 1) return entries;

  lines.slice(1).forEach((line) => {
    const [date, cal, carb, fat, protein] = line.split(",");
    if (!date) return;
    const iso = date.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;

    entries[iso] = {
      date: iso,
      calories: cal !== undefined && cal !== "" && !isNaN(cal) ? parseFloat(cal) : "",
      carbs: carb !== undefined && carb !== "" && !isNaN(carb) ? parseFloat(carb) : "",
      fat: fat !== undefined && fat !== "" && !isNaN(fat) ? parseFloat(fat) : "",
      protein: protein !== undefined && protein !== "" && !isNaN(protein) ? parseFloat(protein) : "",
    };
  });
  return entries;
}

// Helper to save entries dictionary to data.csv
function writeCSV(entries) {
  const dates = Object.keys(entries).sort((a, b) => a.localeCompare(b));
  const lines = ["Date,Calories,Carbs,Fat,Protein"];
  dates.forEach((iso) => {
    const e = entries[iso] || {};
    lines.push([
      iso,
      e.calories ?? "",
      e.carbs ?? "",
      e.fat ?? "",
      e.protein ?? ""
    ].join(","));
  });
  const csvContent = lines.join("\n") + "\n";
  fs.writeFileSync(CSV_FILE, csvContent, "utf8");
  return csvContent;
}

// Estimate calories from macros
function estimateCalories(carb, fat, protein) {
  return Math.round((carb || 0) * 4 + (protein || 0) * 4 + (fat || 0) * 9);
}

// Create MCP Server
const server = new Server(
  {
    name: "daily-macro-tracker-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool schemas
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_entries",
        description: "Retrieve logged daily macro entries from data.csv with optional date range filter.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: { type: "string", description: "Optional start date in YYYY-MM-DD format" },
            endDate: { type: "string", description: "Optional end date in YYYY-MM-DD format" }
          }
        }
      },
      {
        name: "log_day",
        description: "Log or update macro entries for a specific day in data.csv. Auto-calculates calories if omitted.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date in YYYY-MM-DD format" },
            calories: { type: "number", description: "Calories in kcal (optional, auto-computed if omitted)" },
            carbs: { type: "number", description: "Carbs in grams" },
            fat: { type: "number", description: "Fat in grams" },
            protein: { type: "number", description: "Protein in grams" }
          },
          required: ["date"]
        }
      },
      {
        name: "delete_day",
        description: "Delete a daily macro entry by date from data.csv.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date in YYYY-MM-DD format to delete" }
          },
          required: ["date"]
        }
      },
      {
        name: "get_summary",
        description: "Get today's logged macros, 7-day average stats, and goals.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "export_csv",
        description: "Export the full raw contents of data.csv.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      }
    ]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const entries = readCSV();

  if (name === "get_entries") {
    let result = Object.values(entries).sort((a, b) => b.date.localeCompare(a.date));
    if (args?.startDate) {
      result = result.filter(e => e.date >= args.startDate);
    }
    if (args?.endDate) {
      result = result.filter(e => e.date <= args.endDate);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }

  if (name === "log_day") {
    const { date, calories, carbs, fat, protein } = args;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid date format. Use YYYY-MM-DD." }]
      };
    }

    let finalCal = calories;
    if ((finalCal === undefined || finalCal === null || finalCal === "") &&
        (carbs !== undefined || fat !== undefined || protein !== undefined)) {
      finalCal = estimateCalories(carbs, fat, protein);
    }

    entries[date] = {
      date,
      calories: finalCal ?? "",
      carbs: carbs ?? "",
      fat: fat ?? "",
      protein: protein ?? ""
    };

    writeCSV(entries);
    return {
      content: [{ type: "text", text: `Successfully logged day ${date}: ${JSON.stringify(entries[date])}` }]
    };
  }

  if (name === "delete_day") {
    const { date } = args;
    if (!entries[date]) {
      return {
        content: [{ type: "text", text: `No entry found for date ${date}.` }]
      };
    }
    delete entries[date];
    writeCSV(entries);
    return {
      content: [{ type: "text", text: `Successfully deleted entry for ${date}.` }]
    };
  }

  if (name === "get_summary") {
    const todayISO = new Date().toISOString().slice(0, 10);
    const todayEntry = entries[todayISO] || null;

    const datesDesc = Object.keys(entries).sort((a, b) => b.localeCompare(a));
    const last7Dates = datesDesc.slice(0, 7);

    function calcAvg(key) {
      const vals = last7Dates.map(d => entries[d][key]).filter(v => typeof v === "number" && !isNaN(v));
      if (!vals.length) return 0;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    const summary = {
      today: todayEntry,
      last7DaysAvg: {
        calories: calcAvg("calories"),
        carbs: calcAvg("carbs"),
        fat: calcAvg("fat"),
        protein: calcAvg("protein")
      },
      totalDaysLogged: datesDesc.length,
      defaultGoals: { calories: 2000, carbs: 180, fat: 60, protein: 185 }
    };

    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
    };
  }

  if (name === "export_csv") {
    const rawCSV = fs.existsSync(CSV_FILE) ? fs.readFileSync(CSV_FILE, "utf8") : "";
    return {
      content: [{ type: "text", text: rawCSV }]
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

// Start transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP Server Error:", err);
  process.exit(1);
});
