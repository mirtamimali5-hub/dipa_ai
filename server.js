
‎// DIPA AI - secure backend (zero dependencies, Node 18+)
const express = require("express");
const path = require("path");
require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Gemini AI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = "gemini-3-flash-preview";

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    app: "DIPA AI",
    provider: "Google Gemini",
    model: MODEL,
  });
});

// Chat API
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Please enter a valid message.",
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Gemini API key is missing on the server.",
      });
    }

    const contents = [];

    if (Array.isArray(history)) {
      for (const item of history.slice(-20)) {
        if (
          item &&
          typeof item.content === "string" &&
          ["user", "model"].includes(item.role)
        ) {
          contents.push({
            role: item.role,
            parts: [{ text: item.content }],
          });
        }
      }
    }

    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction:
          "You are DIPA AI, a helpful multilingual AI assistant. Answer clearly and accurately. Support Bengali, Hindi and English. Reply in the language used by the user. Never pretend to have performed an action that you have not performed.",
        temperature: 0.7,
      },
    });

    res.json({
      success: true,
      reply: response.text || "I could not generate a response.",
      model: MODEL,
    });
  } catch (error) {
    console.error("Gemini API Error:", error);

    const status = Number(error.status) || 500;

    res.status(status).json({
      success: false,
      error:
        status === 429
          ? "Gemini API quota exceeded. Please try again later."
          : "DIPA AI could not process your request.",
    });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`DIPA AI server running on port ${PORT}`);
});
