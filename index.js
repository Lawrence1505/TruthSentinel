import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import { Firestore } from "@google-cloud/firestore";
import { VertexAI } from "@google-cloud/vertexai";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobe from '@ffprobe-installer/ffprobe';
import { fileURLToPath } from 'url';

// --- SETUP ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobe.path);

const app = express();
app.use(cors());
app.use(express.json());


// --- SERVE STATIC FRONTEND FILES ---
app.use(express.static(__dirname));


// --- INITIALIZE GOOGLE CLOUD CLIENTS ---
const firestore = new Firestore();
const vertex_ai = new VertexAI({ project: "qodo-guardian", location: "us-central1" });
const model = vertex_ai.getGenerativeModel({
    model: "gemini-2.5-pro", // Using the stable, globally-available model to avoid errors
});
const storage = new Storage();
const bucket = storage.bucket("theog");
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 200 * 1024 * 1024
    },
});


// --- API ROUTES (Prefixed with /api) ---

app.get("/api/health", (req, res) => res.json({ ok: true, msg: "Backend API is working!" }));

app.post("/api/signup", async (req, res) => {
    try {
        const { email, password } = req.body;
        const usersRef = firestore.collection("users");
        const snapshot = await usersRef.where("email", "==", email).get();
        if (!snapshot.empty) {
            return res.status(400).json({ success: false, msg: "User with this email already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await usersRef.add({ email, password: hashedPassword, createdAt: new Date() });
        res.status(201).json({ success: true, msg: "User created successfully" });
    } catch (error) {
        console.error("Signup Error:", error);
        res.status(500).json({ success: false, msg: "Something went wrong on the server" });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const usersRef = firestore.collection("users");
        const snapshot = await usersRef.where("email", "==", email).get();
        if (snapshot.empty) {
            return res.status(404).json({ success: false, msg: "User not found" });
        }
        const userDoc = snapshot.docs[0];
        const user = userDoc.data();
        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) {
            return res.status(401).json({ success: false, msg: "Invalid credentials" });
        }
        res.json({ success: true, msg: "Login successful" });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ success: false, msg: "Something went wrong on the server" });
    }
});

app.post("/api/analyze/text", async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) { return res.status(400).json({ success: false, msg: "Text is required" }); }
        const prompt = `Analyze this text for misinformation. Return ONLY a valid JSON object with the keys "verdict", "confidence", and "explanation". Verdict can be "safe", "misinformation", or "caution". Confidence is a number from 0 to 1. Explanation is a brief summary. Text: "${text}"`;
        const request = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
        const result = await model.generateContent(request);
        const response = result.response;
        const rawText = response.candidates[0].content.parts[0].text;
        const cleanedText = rawText.replace("```json", "").replace("```", "").trim();
        const analysisJson = JSON.parse(cleanedText);
        await firestore.collection("analyses").add({ type: "text", inputText: text, result: analysisJson, createdAt: new Date() });
        res.json({ success: true, analysis: analysisJson });
    } catch (error) {
        console.error("Analysis Error:", error);
        res.status(500).json({ success: false, msg: "Error analyzing text" });
    }
});

app.post("/api/analyze/image", upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        if (!file) { return res.status(400).json({ success: false, msg: "No file uploaded." }); }
        const blob = bucket.file(`images/${Date.now()}-${file.originalname}`);
        await new Promise((resolve, reject) => {
            const blobStream = blob.createWriteStream({ resumable: false });
            blobStream.on('error', (err) => reject(err));
            blobStream.on('finish', () => resolve());
            blobStream.end(file.buffer);
        });
        const imagePart = { inlineData: { data: file.buffer.toString("base64"), mimeType: file.mimetype }};
        const promptPart = { text: `Analyze this image for signs of manipulation, deepfakes, or misinformation. Return ONLY a valid JSON object with the keys "verdict", "confidence", and "explanation".`};
        const request = { contents: [{ role: 'user', parts: [promptPart, imagePart] }] };
        const result = await model.generateContent(request);
        const response = result.response;
        const rawText = response.candidates[0].content.parts[0].text;
        const cleanedText = rawText.replace("```json", "").replace("```", "").trim();
        const analysisJson = JSON.parse(cleanedText);
        await firestore.collection("analyses").add({ type: "image", fileName: file.originalname, storagePath: `gs://${bucket.name}/${blob.name}`, result: analysisJson, createdAt: new Date() });
        res.json({ success: true, analysis: analysisJson });
    } catch (error) {
        console.error("Image Analysis Error:", error);
        res.status(500).json({ success: false, msg: "Error analyzing image" });
    }
});

app.post("/api/analyze/video", upload.single("file"), async (req, res) => {
    const tmpDir = os.tmpdir();
    const frameDir = path.join(tmpDir, `frames_${Date.now()}`);
    let tmpVideoPath = '';
    try {
        const file = req.file;
        if (!file) { return res.status(400).json({ success: false, msg: "No video file uploaded." }); }
        if (!fs.existsSync(frameDir)) fs.mkdirSync(frameDir);
        tmpVideoPath = path.join(tmpDir, `upload_${Date.now()}_${file.originalname}`);
        fs.writeFileSync(tmpVideoPath, file.buffer);
        await new Promise((resolve, reject) => {
            ffmpeg(tmpVideoPath).screenshots({ count: 8, folder: frameDir, filename: 'frame-%03d.png', size: '640x?' }).on('end', resolve).on('error', reject);
        });
        const frameFiles = fs.readdirSync(frameDir);
        const imageParts = frameFiles.map(frameFile => ({
            inlineData: { data: fs.readFileSync(path.join(frameDir, frameFile)).toString("base64"), mimeType: 'image/png' }
        }));
        const promptPart = { text: `Analyze this sequence of frames from a video for signs of manipulation, deepfakes, or misinformation. Look for inconsistencies between frames. Return ONLY a valid JSON object with the keys "verdict", "confidence", and "explanation".`};
        const request = { contents: [{ role: 'user', parts: [promptPart, ...imageParts] }] };
        const result = await model.generateContent(request);
        const response = result.response;
        const rawText = response.candidates[0].content.parts[0].text;
        const cleanedText = rawText.replace("```json", "").replace("```", "").trim();
        const analysisJson = JSON.parse(cleanedText);
        const blob = bucket.file(`videos/${Date.now()}-${file.originalname}`);
        await blob.save(file.buffer);
        await firestore.collection("analyses").add({ type: "video", fileName: file.originalname, storagePath: `gs://${bucket.name}/${blob.name}`, result: analysisJson, createdAt: new Date() });
        res.json({ success: true, analysis: analysisJson });
    } catch (error) {
        console.error("Video Analysis Error:", error);
        res.status(500).json({ success: false, msg: "Error analyzing video" });
    } finally {
        if (tmpVideoPath && fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);
        if (fs.existsSync(frameDir)) fs.rmSync(frameDir, { recursive: true, force: true });
    }
});

app.post("/api/chat", async (req, res) => {
    try {
        const { messages } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ success: false, msg: "messages array is required" });
        }
        const history = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(m.content || '') }]
        }));
        const chat = model.startChat({
            history: history.slice(0, -1),
        });
        const lastMessage = messages[messages.length - 1].content;
        const result = await chat.sendMessage(lastMessage);
        const response = result.response;
        const reply = response.candidates[0].content.parts[0].text;
        if (reply) {
            const fullConversation = [...messages, { role: 'assistant', content: reply }];
            await firestore.collection("chats").add({
                firstMessage: messages[0]?.content || 'Chat',
                lastMessageTimestamp: new Date(),
                conversation: fullConversation
            });
        }
        return res.json({ success: true, reply });
    } catch (error) {
        console.error("Chat Error:", error);
        return res.status(500).json({ success: false, msg: "Error during chat" });
    }
});


// --- CATCH-ALL ROUTE ---
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// --- START SERVER ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
