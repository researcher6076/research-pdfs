import fs from "fs";
import pdf from "pdf-parse";

export async function extractTextFromPDF(path) {
  const dataBuffer = fs.readFileSync(path);
  const data = await pdf(dataBuffer);
  return data.text;
}
