import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import pdfParse from "pdf-parse";
import { fileURLToPath } from "url";

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let step = 0;
let fileJson = null;

// Normalize path (for Windows + file://)
function normalizePath(inputPath) {
  if (inputPath.startsWith("file:///")) {
    return fileURLToPath(inputPath);
  }
  return inputPath;
}

// Check if line looks like a "heading"
function isHeading(line) {
  if (!line) return false;
  if (line.includes(":")) return false;
  // Heading is short (<5 words) and starts with uppercase
  return /^[A-Z][A-Za-z ]{1,50}$/.test(line.trim());
}

// PDF → JSON (headings as keys, values as values)
function parsePdfToJson(text) {
  const jsonData = {};
  const lines = text.split("\n").map(l => l.trim()).filter(l => l);

  let currentKey = null;
  let buffer = [];

  for (let line of lines) {
    if (isHeading(line)) {
      if (currentKey) {
        jsonData[currentKey] = buffer.join("\n").trim();
      }
      currentKey = line;
      buffer = [];
    } else {
      if (line.includes(":")) {
        // Explicit key:value
        const [key, value] = line.split(":");
        jsonData[key.trim()] = value.trim();
      } else {
        buffer.push(line);
      }
    }
  }

  if (currentKey) {
    jsonData[currentKey] = buffer.join("\n").trim();
  }

  return jsonData;
}

io.on("connection", (socket) => {
  console.log("✅ User connected");

  socket.on("sendMessage", async (msg) => {
    console.log("📩 Message:", msg);

    try {
      if (msg.toLowerCase() === "new") {
        step = 0;
        fileJson = null;
        socket.emit("receiveMessage", "🆕 New chat started. Type 'hi' to begin.");
        return;
      }

      if (step === 0 && msg.toLowerCase() === "hi") {
        step = 1;
        socket.emit("receiveMessage", "👋 Please enter the PDF file path:");
      } else if (step === 1) {
        const filePath = normalizePath(msg);

        if (fs.existsSync(filePath)) {
          const pdfBuffer = fs.readFileSync(filePath);
          const data = await pdfParse(pdfBuffer);

          fileJson = parsePdfToJson(data.text);
          step = 2;

          socket.emit("receiveMessage", `✅ File loaded! Extracted sections: ${Object.keys(fileJson).join(", ")}. Ask me about them.`);
        } else {
          socket.emit("receiveMessage", "❌ File not found. Please try again.");
        }
      } else if (step === 2) {
        if (!fileJson) {
          socket.emit("receiveMessage", "❌ No file loaded. Type 'hi' to start.");
          return;
        }

        const lowerQ = msg.toLowerCase();
        let answer = null;

        const foundKey = Object.keys(fileJson).find(k =>
          lowerQ.includes(k.toLowerCase())
        );

        if (foundKey) {
          answer = fileJson[foundKey];
        }

        if (answer) {
          socket.emit("receiveMessage", `📖 ${answer}`);
        } else {
          socket.emit("receiveMessage", "❌ Sorry, I couldn’t find that info in the PDF.");
        }
      }
    } catch (err) {
      console.error("❌ Error:", err);
      socket.emit("receiveMessage", "⚠️ Error: " + err.message);
    }
  });
});

server.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});
