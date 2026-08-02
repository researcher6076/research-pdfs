import fs from "fs";
import path from "path";
import { extractTextFromPDF } from "./extract-text.js";

const pdfDir = "./pdfs";
const outputFile = "./updates/search-index.json";

async function buildIndex() {
  const files = fs.readdirSync(pdfDir).filter(f => f.endsWith(".pdf"));
  const index = [];

  for (const file of files) {
    const fullPath = path.join(pdfDir, file);
    const text = await extractTextFromPDF(fullPath);

    index.push({
      title: file.replace(".pdf", ""),
      url: `https://researcher6076.com/pdfs/${file}`,
      content: text
    });
  }

  fs.writeFileSync(outputFile, JSON.stringify(index, null, 2));
}

buildIndex();
