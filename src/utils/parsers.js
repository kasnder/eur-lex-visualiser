import { isFmxDocument, parseFmxToCombined } from "./fmxParser.js";

export function parseFormexToCombined(text) {
  if (!isFmxDocument(text)) {
    throw new Error("Expected cached Formex XML content.");
  }

  return parseFmxToCombined(text);
}
