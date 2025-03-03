///////////////////////////////////////////////////////////
// server.js
//
// - YouTube: ytdl-core + yt-dlp fallback
// - Sosyal Medya (Twitter/IG/FB): yt-dlp (Twitter için cookie desteği eklenmiştir)
// - Normal dosyalar: segmentli / tek parça
// - Pause/Resume, Kuyruk Yönetimi, Hız Sınırlama (token bucket)
// - Global PATH’te yt-dlp yüklü varsayılıyor
///////////////////////////////////////////////////////////

import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import ytdl from "ytdl-core";
import youtubeDlExec from "youtube-dl-exec";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Kullanılacak ortak header bilgisi (User-Agent ekliyoruz)
const commonHeaders = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36"
};

// ================== JOB LİSTESİ ==================
let jobs = [];
const maxConcurrency = 2;
let currentRunning = 0;

// Hız Sınırlama (Token Bucket)
let globalThrottleLimit = 50 * 1024; // 50 KB/s
let tokenBucket = {
    tokens: globalThrottleLimit,
    lastRefill: Date.now()
};
setInterval(() => {
    tokenBucket.tokens = globalThrottleLimit;
    tokenBucket.lastRefill = Date.now();
}, 1000);

////////////////////////////////////////////////////
// 1) API Endpoint'leri
////////////////////////////////////////////////////
app.post("/add-to-queue", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL gerekiyor." });
    const newJob = {
        id: uuidv4(),
        url,
        status: "queued",
        progress: 0,
        segments: [],
        type: "" // "youtube", "social", "normal"
    };
    jobs.push(newJob);
    processQueue();
    return res.json({ message: "Kuyruğa eklendi", job: newJob });
});

app.get("/queue", (req, res) => {
    res.json(jobs);
});

app.post("/set-throttle", (req, res) => {
    const { limit } = req.body;
    globalThrottleLimit = limit;
    tokenBucket.tokens = limit;
    res.json({ message: `Hız limiti güncellendi: ${limit} B/s` });
});

app.post("/pause", (req, res) => {
    const { jobId } = req.body;
    const job = jobs.find(j => j.id === jobId);
    if (!job) return res.status(404).json({ error: "Job bulunamadı." });
    if (job.status === "downloading") {
        job.status = "paused";
        job.segments.forEach(seg => seg.controller?.abort());
        return res.json({ message: "Job duraklatıldı", job });
    }
    res.json({ message: `Job duraklatılamadı (durum: ${job.status})`, job });
});

app.post("/resume", (req, res) => {
    const { jobId } = req.body;
    const job = jobs.find(j => j.id === jobId);
    if (!job) return res.status(404).json({ error: "Job bulunamadı." });
    if (job.status === "paused" || job.status === "error") {
        job.status = "queued";
        processQueue();
        return res.json({ message: "Job devam ettirildi (queued).", job });
    }
    res.json({ message: `Job devam ettirilemedi (durum: ${job.status})`, job });
});

////////////////////////////////////////////////////
// 2) Kuyruk Yönetimi
////////////////////////////////////////////////////
function processQueue() {
    if (currentRunning >= maxConcurrency) return;
    const nextJob = jobs.find(j => j.status === "queued");
    if (!nextJob) return;
    nextJob.status = "downloading";
    currentRunning++;
    downloadJob(nextJob)
        .then(() => {
            if (nextJob.status !== "paused") {
                nextJob.status = "done";
                nextJob.progress = 1;
            }
        })
        .catch(err => {
            console.error("Job hata:", err.message);
            if (nextJob.status !== "paused") nextJob.status = "error";
        })
        .finally(() => {
            currentRunning--;
            processQueue();
        });
}

////////////////////////////////////////////////////
// 3) Ana İndirme Mantığı
////////////////////////////////////////////////////
async function downloadJob(job) {
    if (isYouTubeLink(job.url)) {
        job.type = "youtube";
        return downloadYouTube(job);
    } else if (isSocialMediaLink(job.url)) {
        job.type = "social";
        return downloadSocialMediaVideo(job);
    } else {
        job.type = "normal";
        return downloadNormalFile(job);
    }
}

function isYouTubeLink(url) {
    return url.includes("youtube.com") || url.includes("youtu.be");
}

function isSocialMediaLink(url) {
    return url.includes("twitter.com") ||
        url.includes("instagram.com") ||
        url.includes("facebook.com");
}

////////////////////////////////////////////////////
// 4) YouTube İndirme (ytdl-core + yt-dlp fallback)
////////////////////////////////////////////////////
async function downloadYouTube(job) {
    try {
        console.log("YouTube link tespit edildi, ytdl-core ile indiriliyor:", job.url);
        return await downloadYouTubeYtdl(job);
    } catch (err) {
        console.warn("ytdl-core hata verdi:", err.message);
        console.log("yt-dlp fallback deneniyor...");
        return downloadYouTubeDlExec(job);
    }
}

async function downloadYouTubeYtdl(job) {
    const info = await ytdl.getInfo(job.url);
    let title = (info.videoDetails.title || `video-${job.id}`).replace(/[^\w\s-]/g, "");
    const outDir = path.join(__dirname, "downloads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const finalPath = path.join(outDir, title + ".mp4");
    const video = ytdl(job.url, { quality: "highestvideo" });
    const ws = fs.createWriteStream(finalPath);
    return new Promise((resolve, reject) => {
        video.pipe(ws);
        video.on("end", () => {
            console.log("YouTube ytdl-core indirme tamamlandı:", finalPath);
            resolve();
        });
        video.on("error", reject);
    });
}

async function downloadYouTubeDlExec(job) {
    const outDir = path.join(__dirname, "downloads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const execParams = {
        output: path.join(outDir, "%(title)s.%(ext)s"),
        format: "best"
    };
    try {
        await youtubeDlExec(job.url, execParams);
        job.progress = 1;
        console.log("YouTube (yt-dlp) indirme tamamlandı.");
    } catch (err) {
        console.error("yt-dlp hata ayrıntısı:", err);
        throw err;
    }
}

////////////////////////////////////////////////////
// 5) Sosyal Medya İndirme (yt-dlp) – Cookie Desteği ile
////////////////////////////////////////////////////
async function downloadSocialMediaVideo(job) {
    console.log("Sosyal medya link tespit edildi:", job.url);
    return executeYtDlp(job);
}

async function executeYtDlp(job) {
    const outDir = path.join(__dirname, "downloads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const execParams = {
        output: path.join(outDir, "%(title)s.%(ext)s"),
        format: "best"
    };
    // Eğer Twitter videoları için cookie gerekiyorsa, cookieStore üzerinden kontrol edelim:
    if (job.url.includes("twitter.com") && cookieStore["twitter.com"]) {
        execParams.cookies = cookieStore["twitter.com"];
    }
    try {
        await youtubeDlExec(job.url, execParams);
        job.progress = 1;
        console.log("Sosyal medya (yt-dlp) indirme tamamlandı.");
    } catch (err) {
        console.error("yt-dlp hata:", err);
        throw err;
    }
}

////////////////////////////////////////////////////
// 6) Normal Dosya İndirme
////////////////////////////////////////////////////
async function downloadNormalFile(job) {
    const finalName = await guessFilename(job.url);
    const outDir = path.join(__dirname, "downloads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    let size = 0;
    try {
        size = await getFileSize(job.url);
    } catch (err) {
        console.warn("content-length alınamadı => tek parça indir.", err.message);
        return downloadFileInSingleChunk(job, outDir, finalName);
    }
    const rangeOk = await supportsRangeRequests(job.url);
    if (!rangeOk) {
        console.warn("Sunucu Range desteği yok => tek parça indir.");
        return downloadFileInSingleChunk(job, outDir, finalName);
    }
    await downloadSegmented(job, size, outDir, finalName);
}

async function downloadFileInSingleChunk(job, outDir, fileName) {
    job.segments = [];
    const resp = await fetch(job.url, { headers: commonHeaders });
    if (!resp.ok) throw new Error(`Tek parça hata: ${resp.status}`);
    const cLen = resp.headers.get("content-length");
    let totalSize = cLen ? parseInt(cLen, 10) : 0;
    let downloaded = 0;
    const finalPath = path.join(outDir, fileName);
    const ws = fs.createWriteStream(finalPath);
    return new Promise((resolve, reject) => {
        resp.body.on("data", (chunk) => {
            ws.write(chunk);
            downloaded += chunk.length;
            if (totalSize > 0) {
                job.progress = downloaded / totalSize;
            } else {
                job.progress += chunk.length / (1024 * 1024 * 50);
            }
        });
        resp.body.on("end", () => {
            ws.end();
            job.progress = 1;
            resolve();
        });
        resp.body.on("error", (err) => {
            ws.end();
            reject(err);
        });
    });
}

async function downloadSegmented(job, totalSize, outDir, fileName) {
    const segCount = 4;
    const segSize = Math.ceil(totalSize / segCount);
    job.progress = 0;
    job.segments = [];
    for (let i = 0; i < segCount; i++) {
        const start = i * segSize;
        let end = (i + 1) * segSize - 1;
        if (end >= totalSize) end = totalSize - 1;
        if (start >= totalSize) break;
        job.segments.push({
            index: i,
            start,
            end,
            downloaded: 0,
            total: end - start + 1,
            status: "pending",
            controller: null
        });
    }
    for (const seg of job.segments) {
        if (job.status === "paused" || job.status === "error") return;
        seg.status = "downloading";
        await downloadSegment(job, seg, totalSize, outDir, fileName);
        seg.status = "done";
    }
    await mergeSegments(job, outDir, fileName);
    for (const seg of job.segments) {
        const partFile = path.join(outDir, `${fileName}.part${seg.index}`);
        if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
    }
}

async function downloadSegment(job, seg, totalSize, outDir, fileName) {
    const partFile = path.join(outDir, `${fileName}.part${seg.index}`);
    let alreadyDownloaded = 0;
    if (fs.existsSync(partFile)) {
        const st = fs.statSync(partFile);
        alreadyDownloaded = st.size;
    }
    const segStart = seg.start + alreadyDownloaded;
    const segEnd = seg.end;
    if (segStart > segEnd) {
        job.progress += seg.total / totalSize;
        seg.downloaded = seg.total;
        return;
    }
    const controller = new AbortController();
    seg.controller = controller;
    const rangeHeader = `bytes=${segStart}-${segEnd}`;
    console.log(`Job ${job.id}, segment#${seg.index} => ${rangeHeader}`);
    const resp = await fetch(job.url, {
        headers: commonHeaders,
        // Ekstra header'lar eklendi.
        headers: { ...commonHeaders, Range: rangeHeader },
        signal: controller.signal
    });
    if (!resp.ok || (resp.status !== 206 && resp.status !== 200)) {
        throw new Error(`Segment hata: ${resp.status}`);
    }
    const ws = fs.createWriteStream(partFile, { flags: "a" });
    return new Promise((resolve, reject) => {
        resp.body.on("data", (chunk) => {
            if (globalThrottleLimit > 0) {
                if (tokenBucket.tokens >= chunk.length) {
                    tokenBucket.tokens -= chunk.length;
                } else {
                    resp.body.pause();
                    setTimeout(() => resp.body.resume(), 200);
                }
            }
            ws.write(chunk);
            seg.downloaded += chunk.length;
            job.progress += chunk.length / totalSize;
        });
        resp.body.on("end", () => {
            ws.end();
            seg.controller = null;
            resolve();
        });
        resp.body.on("error", (err) => {
            ws.end();
            seg.controller = null;
            reject(err);
        });
        controller.signal.addEventListener("abort", () => {
            ws.end();
            reject(new Error("Segment abort."));
        });
    });
}

function mergeSegments(job, outDir, fileName) {
    return new Promise((resolve, reject) => {
        const finalPath = path.join(outDir, fileName);
        const ws = fs.createWriteStream(finalPath);
        let idx = 0;
        function appendNext() {
            if (idx >= job.segments.length) {
                ws.end(() => resolve());
                return;
            }
            const partFile = path.join(outDir, `${fileName}.part${idx}`);
            idx++;
            if (!fs.existsSync(partFile)) {
                appendNext();
                return;
            }
            const rs = fs.createReadStream(partFile);
            rs.on("end", () => appendNext());
            rs.on("error", reject);
            rs.pipe(ws, { end: false });
        }
        appendNext();
    });
}

////////////////////////////////////////
// Yardımcı Fonksiyonlar
////////////////////////////////////////
async function getFileSize(url) {
    let headRes = await fetch(url, { method: "HEAD", headers: commonHeaders });
    if (!headRes.ok) {
        headRes = await fetch(url, { method: "GET", headers: { ...commonHeaders, Range: "bytes=0-1" } });
        if (!headRes.ok) {
            throw new Error(`HEAD+GET hata: ${headRes.status}`);
        }
    }
    const cLen = headRes.headers.get("content-length");
    if (!cLen) {
        throw new Error("content-length yok, segmentli yapılamaz.");
    }
    return parseInt(cLen, 10);
}

async function supportsRangeRequests(url) {
    const res = await fetch(url, { method: "HEAD", headers: commonHeaders });
    if (!res.ok) return false;
    return res.headers.get("accept-ranges") === "bytes";
}

async function guessFilename(url) {
    try {
        let hr = await fetch(url, { method: "HEAD", headers: commonHeaders });
        if (!hr.ok) {
            hr = await fetch(url, { method: "GET", headers: { ...commonHeaders, Range: "bytes=0-1" } });
        }
        const disp = hr.headers.get("content-disposition");
        if (disp && disp.includes("filename=")) {
            const match = disp.match(/filename="?(.+)"?/);
            if (match && match[1]) return match[1];
        }
        const ctype = hr.headers.get("content-type") || "";
        const extMap = {
            "video/mp4": "mp4",
            "audio/mpeg": "mp3",
            "image/png": "png",
            "image/jpeg": "jpg",
            "application/zip": "zip"
        };
        let fallbackExt = "";
        if (extMap[ctype]) fallbackExt = "." + extMap[ctype];
        const gUrl = extractFilenameFromUrl(url);
        if (gUrl) return gUrl;
        const base = path.basename(new URL(url).pathname);
        if (!base || base === "/") {
            return `file-${Date.now()}${fallbackExt || ""}`;
        }
        if (fallbackExt && !base.includes(".")) {
            return base + fallbackExt;
        }
        return base;
    } catch (err) {
        console.warn("guessFilename fallback:", err);
        return `file-${Date.now()}.bin`;
    }
}

function extractFilenameFromUrl(u) {
    try {
        const urlObj = new URL(u);
        for (const [k, v] of urlObj.searchParams.entries()) {
            if (k.toLowerCase().includes("file") && v.includes(".")) {
                return v;
            }
        }
        return null;
    } catch (err) {
        return null;
    }
}

////////////////////////////////////////
// Sunucuyu Başlat
////////////////////////////////////////
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 IDM Node Sunucusu çalışıyor: http://localhost:${PORT}`);
});
