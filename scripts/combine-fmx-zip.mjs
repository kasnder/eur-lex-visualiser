#!/usr/bin/env node
/**
 * Combine a multi-file Formex ZIP into a single XML file.
 *
 * EU Formex ZIPs contain a manifest (*.doc.fmx.xml) that lists:
 *   - DOC.MAIN.PUB → main regulation (ACT root)
 *   - DOC.SUB.PUB  → annexes (ANNEX root)
 *
 * This script reads all referenced files and wraps them in a single
 * <COMBINED.FMX> root element for the browser-side parser.
 *
 * Usage:
 *   node scripts/combine-fmx-zip.mjs <input.zip> <output.xml>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [zipPath, outPath] = process.argv.slice(2);

if (!zipPath || !outPath) {
  console.error("Usage: node scripts/combine-fmx-zip.mjs <input.zip> <output.xml>");
  process.exit(1);
}

// Extract ZIP to temp dir
const tmp = mkdtempSync(join(tmpdir(), "fmx-"));
try {
  execSync(`unzip -o "${zipPath}" -d "${tmp}"`, { stdio: "pipe" });

  const files = readdirSync(tmp);

  // Find the manifest (*.doc.fmx.xml)
  const docFile = files.find((f) => f.endsWith(".doc.fmx.xml"));
  if (!docFile) {
    throw new Error("No *.doc.fmx.xml manifest found in ZIP");
  }
  const manifest = readFileSync(join(tmp, docFile), "utf8");

  // Extract file references from manifest using regex
  // DOC.MAIN.PUB contains the main act
  // DOC.SUB.PUB contains annexes
  const refPattern = /FILE="([^"]+)"/g;
  const physRefs = [];
  let m;
  while ((m = refPattern.exec(manifest)) !== null) {
    const ref = m[1];
    if (ref.endsWith(".fmx.xml") && ref !== docFile && files.includes(ref)) {
      physRefs.push(ref);
    }
  }

  // Build combined XML
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>'];
  parts.push('<COMBINED.FMX xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://formex.publications.europa.eu/schema/formex-06.02.1-20231031.xd">');

  for (const ref of physRefs) {
    let xml = readFileSync(join(tmp, ref), "utf8");
    // Remove XML declaration from individual files
    xml = xml.replace(/<\?xml[^?]*\?>/, "").trim();
    parts.push(xml);
  }

  parts.push("</COMBINED.FMX>");

  writeFileSync(outPath, parts.join("\n"), "utf8");
  console.log(`Combined ${physRefs.length} files → ${outPath}`);
  console.log("  Files:", physRefs.join(", "));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
