import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import { Firestore } from "@google-cloud/firestore";
import { VertexAI } from "@google-cloud/vertexai";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
// NEW: Imports for video processing
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobe from '@ffprobe-installer/ffprobe';

// NEW: Set the path for the ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobe.path);

const app = express();
app.use(cors());
app.use(express.json());

// --- INITIALIZE GOOGLE CLOUD CLIENTS ---

const firestore = new Firestore();

const vertex_ai = new VertexAI({ project: "qodo-guardian", location: "us-central1" });
const model = vertex_ai.getGenerativeModel({
    model: "gemini-2.5-pro", // Using the stable model that works
});

const storage = new Storage();
const bucket = storage.bucket("theog");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 200 * 1024 * 1024 // Increased limit for video files (200MB)
    },
});


// --- AUTHENTICATION ROUTES ---

app.get("/health", (req, res) => res.json({ ok: true, msg: "Backend is working!" }));

app.post("/signup", async (req, res) => {
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

app.post("/login", async (req, res) => {
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


// --- ANALYSIS ROUTES ---

app.post("/analyze/text", async (req, res) => {
    // ... (This route is unchanged)
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

app.post("/analyze/image", upload.single("file"), async (req, res) => {
    // ... (This route is unchanged)
    try {
        const file = req.file;
        if (!file) { return res.status(400).json({ success: false, msg: "No file uploaded." }); }
        console.log("Uploading to Cloud Storage...");
        const blob = bucket.file(`images/${Date.now()}-${file.originalname}`);
        await new Promise((resolve, reject) => {
            const blobStream = blob.createWriteStream({ resumable: false });
            blobStream.on('error', (err) => reject(err));
            blobStream.on('finish', () => resolve());
            blobStream.end(file.buffer);
        });
        console.log("Upload complete.");
        const imagePart = { inlineData: { data: file.buffer.toString("base64"), mimeType: file.mimetype }};
        const promptPart = { text: `Analyze this image for signs of manipulation, deepfakes, or misinformation. Return ONLY a valid JSON object with the keys "verdict", "confidence", and "explanation".`};
        const request = { contents: [{ role: 'user', parts: [promptPart, imagePart] }] };
        console.log("Analyzing with Gemini...");
        const result = await model.generateContent(request);
        const response = result.response;
        const rawText = response.candidates[0].content.parts[0].text;
        const cleanedText = rawText.replace("```json", "").replace("```", "").trim();
        const analysisJson = JSON.parse(cleanedText);
        console.log("Analysis complete.");
        await firestore.collection("analyses").add({ type: "image", fileName: file.originalname, storagePath: `gs://${bucket.name}/${blob.name}`, result: analysisJson, createdAt: new Date() });
        res.json({ success: true, analysis: analysisJson });
    } catch (error) {
        console.error("Image Analysis Error:", error);
        res.status(500).json({ success: false, msg: "Error analyzing image" });
    }
});

// NEW: Added the Video Analysis route
app.post("/analyze/video", upload.single("file"), async (req, res) => {
    const tmpDir = os.tmpdir(); // Use the OS's temporary directory
    const frameDir = path.join(tmpDir, `frames_${Date.now()}`);
    let tmpVideoPath = '';

    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, msg: "No video file uploaded." });
        }

        // 1. Save video temporarily to disk for ffmpeg
        if (!fs.existsSync(frameDir)) fs.mkdirSync(frameDir);
        tmpVideoPath = path.join(tmpDir, `upload_${Date.now()}_${file.originalname}`);
        fs.writeFileSync(tmpVideoPath, file.buffer);
        console.log("Video saved temporarily for frame extraction.");

        // 2. Extract 8 frames from the video
        await new Promise((resolve, reject) => {
            ffmpeg(tmpVideoPath)
                .screenshots({
                    count: 8,
                    folder: frameDir,
                    filename: 'frame-%03d.png',
                    size: '640x?'
                })
                .on('end', resolve)
                .on('error', reject);
        });
        console.log("Frames extracted successfully.");

        // 3. Prepare frames to send to Gemini
        const frameFiles = fs.readdirSync(frameDir);
        const imageParts = frameFiles.map(frameFile => ({
            inlineData: {
                data: fs.readFileSync(path.join(frameDir, frameFile)).toString("base64"),
                mimeType: 'image/png'
            }
        }));

        const promptPart = {
            text: `Analyze this sequence of frames from a video for signs of manipulation, deepfakes, or misinformation. Look for inconsistencies between frames. Return ONLY a valid JSON object with the keys "verdict", "confidence", and "explanation".`
        };

        const request = {
            contents: [{ role: 'user', parts: [promptPart, ...imageParts] }],
        };

        // 4. Call the Gemini model
        console.log("Analyzing video frames with Gemini...");
        const result = await model.generateContent(request);
        const response = result.response;
        const rawText = response.candidates[0].content.parts[0].text;
        const cleanedText = rawText.replace("```json", "").replace("```", "").trim();
        const analysisJson = JSON.parse(cleanedText);
        console.log("Video analysis complete.");
        
        // 5. Upload original video to Cloud Storage
        const blob = bucket.file(`videos/${Date.now()}-${file.originalname}`);
        await blob.save(file.buffer);
        console.log("Original video uploaded to Cloud Storage.");

        // 6. Save result to Firestore
        await firestore.collection("analyses").add({
            type: "video",
            fileName: file.originalname,
            storagePath: `gs://${bucket.name}/${blob.name}`,
            result: analysisJson,
            createdAt: new Date(),
        });

        res.json({ success: true, analysis: analysisJson });

    } catch (error) {
        console.error("Video Analysis Error:", error);
        res.status(500).json({ success: false, msg: "Error analyzing video" });
    } finally {
        // 7. Clean up temporary files
        if (tmpVideoPath && fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);
        if (fs.existsSync(frameDir)) fs.rmSync(frameDir, { recursive: true, force: true });
        console.log("Temporary files cleaned up.");
    }
});


// --- START SERVER ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));