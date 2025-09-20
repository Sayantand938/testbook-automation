#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { program } from "commander";

program
  .requiredOption("--json-path <path>", "Path to JSON file");

program.parse(process.argv);
const options = program.opts();

// Resolve input JSON path relative to CWD
const inputPath = path.resolve(process.cwd(), options.jsonPath);

// Read JSON file
let jsonArray;
try {
  const fileContent = fs.readFileSync(inputPath, "utf-8");
  jsonArray = JSON.parse(fileContent);
  if (!Array.isArray(jsonArray)) {
    throw new Error("JSON root must be an array");
  }
} catch (err) {
  console.error("Error reading/parsing JSON:", err.message);
  process.exit(1);
}

// Metadata lines
const meta = [
  "#separator:tab",
  "#html:true",
  "#tags column:10"
].join("\n");

// Desired column order
const columns = ["SL","Question","OP1","OP2","OP3","OP4","Answer","Solution","_blank","Tags"];

// Build rows
const rows = jsonArray.map(obj => {
  return columns.map(col => {
    if (col === "_blank") return ""; // blank field
    if (col === "Tags") return (obj.Tags || []).join(" "); // space-separated tags
    return String(obj[col] ?? "").replace(/\t/g, " "); // escape tabs
  }).join("\t");
});

// Final TSV
const tsvOutput = meta + "\n" + rows.join("\n");

// Ensure output/tsv folder exists
const outDir = path.resolve(process.cwd(), "output", "tsv");
fs.mkdirSync(outDir, { recursive: true });

// Output file name same as input but with .tsv
const baseName = path.basename(inputPath, path.extname(inputPath));
const outFile = path.join(outDir, baseName + ".tsv");

// Write TSV
fs.writeFileSync(outFile, tsvOutput, "utf-8");
console.log(`✅ TSV saved to ${outFile}`);
