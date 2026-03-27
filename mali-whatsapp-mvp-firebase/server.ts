import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(bodyParser.json());

  // WhatsApp Webhook Verification
  app.get("/api/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
        console.log("WEBHOOK_VERIFIED");
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    }
  });

  // WhatsApp Webhook Event Handling
  app.post("/api/webhook", (req, res) => {
    const body = req.body;

    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        // Handle incoming messages if needed
      }

      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.statuses &&
        body.entry[0].changes[0].value.statuses[0]
      ) {
        const status = body.entry[0].changes[0].value.statuses[0];
        console.log("Status update received:", status.status, "for", status.id);
        // Here we would update Firestore with the new status
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  });

  // API to send WhatsApp message
  app.post("/api/send-message", async (req, res) => {
    const { to, templateName, languageCode, components } = req.body;

    const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      return res.status(500).json({ error: "WhatsApp credentials not configured" });
    }

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: to,
          type: "template",
          template: {
            name: templateName,
            language: {
              code: languageCode || "es",
            },
            components: components || [],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      res.json(response.data);
    } catch (error: any) {
      console.error("Error sending WhatsApp message:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: "Failed to send message" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
