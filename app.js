import express from "express";
import fs from "fs";
import path from "path";
import { PdfReader } from "pdfreader";
import { pipeline } from "@xenova/transformers";

const app = express();
app.use(express.json());

const dataDir = path.join(process.cwd(), "pdf_data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// ------------------- Embedding Setup -------------------
let embedder;
const getEmbedder = async () => {
  if (!embedder) {
    console.log("⏳ Loading embedding model...");
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("✅ Embedding model loaded!");
  }
  return embedder;
};

const getEmbedding = async (text) => {
  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
};

// ------------------- Cosine Similarity -------------------
const cosineSimilarity = (vecA, vecB) => {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (normA * normB);
};

// ------------------- API: Extract PDF -------------------
app.post("/extractPdf", (req, res) => {
  const { filePath } = req.body;
  if (!filePath) {
    return res.status(400).json({ error: "filePath is required" });
  }

  fs.readFile(filePath, (err, pdfBuffer) => {
    if (err) return res.status(500).json({ error: "Error reading file" });

    let rawText = [];

    new PdfReader().parseBuffer(pdfBuffer, async (err, item) => {
      if (err) {
        console.error("PDF parsing error:", err);
        return res.status(500).json({ error: "Failed to parse PDF" });
      } else if (!item) {
        // Parsing finished → join lines into full text
        const fullText = rawText.join(" ").replace(/\s+/g, " ").trim();

        // Split into paragraphs by double newline OR period + capital letter
        const paragraphs = fullText
          .split(/(\. |\n\n)/)
          .map((p) => p.trim())
          .filter((p) => p.length > 50); // ignore too-short chunks

        let documents = [];
        for (let i = 0; i < paragraphs.length; i++) {
          const text = paragraphs[i];
          const embedding = await getEmbedding(text);
          documents.push({ id: i + 1, text, embedding });
        }

        const fileName = `pdf_${Date.now()}.json`;
        const jsonFilePath = path.join(dataDir, fileName);

        await fs.promises.writeFile(
          jsonFilePath,
          JSON.stringify(documents, null, 2)
        );

        console.log("✅ PDF saved at:", jsonFilePath);
        return res.json({
          message: "PDF extracted and embedded successfully",
          fileId: fileName,
          paragraphs: documents.length,
        });
      } else if (item.text) {
        rawText.push(item.text.trim());
      }
    });
  });
});

// ------------------- API: Ask Question -------------------
app.post("/ask", async (req, res) => {
  const { fileId, question } = req.body;

  if (!fileId || !question) {
    return res.status(400).json({ error: "fileId and question are required" });
  }

  const filePath = path.join(dataDir, fileId);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  try {
    const documents = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    const queryEmbedding = await getEmbedding(question);

    const ranked = documents
      .map((doc) => ({
        id: doc.id,
        text: doc.text,
        score: cosineSimilarity(queryEmbedding, doc.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    const top = ranked.slice(0, 3); // top 3 matches
    res.json({ answer: top });
  } catch (err) {
    console.error("Error in ask API:", err);
    return res.status(500).json({ error: "Error processing your request" });
  }
});

// ------------------- Start Server -------------------
app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});
