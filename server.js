// import express from "express";
// import { spawn } from "child_process";
// import path from "path";
// import { fileURLToPath } from "url";
// import fs from "fs";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();
// app.use(express.json());

// const DOWNLOAD_DIR = path.join(__dirname, "downloads");
// if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// /**
//  * URL’ye göre uygun yt-dlp argümanlarını döndürür.
//  */
// function getDownloadArgs(url) {
//     if (url.includes("youtube.com") || url.includes("youtu.be")) {
//         return ["-f", "bestvideo+bestaudio/best", "-o", `${DOWNLOAD_DIR}/%(title)s.%(ext)s`, url];
//     } else if (url.includes("instagram.com")) {
//         return ["-f", "best", "-o", `${DOWNLOAD_DIR}/%(title)s.%(ext)s`, url];
//     } else if (url.includes("twitter.com") || url.includes("x.com")) {
//         return ["-f", "bv+ba/b", "-o", `${DOWNLOAD_DIR}/%(title)s.%(ext)s`, url];
//     } else {
//         return ["-o", `${DOWNLOAD_DIR}/%(title)s.%(ext)s`, url];
//     }
// }

// /**
//  * /add-to-queue endpoint’i
//  * İlgili URL’e göre yt-dlp komutunu çalıştırır.
//  */
// app.post("/add-to-queue", (req, res) => {
//     const { url } = req.body;
//     if (!url) return res.status(400).json({ error: "URL gerekli." });

//     const args = getDownloadArgs(url);
//     console.log("İndirme başlatılıyor:", args.join(" "));

//     const ytDlpProcess = spawn("yt-dlp", args, { shell: true });

//     let output = "";
//     let errorOutput = "";

//     ytDlpProcess.stdout.on("data", (data) => {
//         output += data.toString();
//         console.log(`[yt-dlp]: ${data}`);
//     });

//     ytDlpProcess.stderr.on("data", (data) => {
//         errorOutput += data.toString();
//         console.error(`[yt-dlp hata]: ${data}`);
//     });

//     ytDlpProcess.on("close", (code) => {
//         if (code === 0) {
//             console.log("✅ İndirme tamamlandı!");
//             res.json({ message: "İndirme tamamlandı.", output });
//         } else {
//             console.error("❌ İndirme başarısız oldu!");
//             res.status(500).json({ message: "İndirme başarısız oldu.", error: errorOutput });
//         }
//     });
// });

// /**
//  * /list-downloads endpoint’i
//  * İndirilen dosyaları listeler.
//  */
// app.get("/list-downloads", (req, res) => {
//     fs.readdir(DOWNLOAD_DIR, (err, files) => {
//         if (err) {
//             return res.status(500).json({ error: "Dosyalar listelenemedi." });
//         }
//         res.json({ files });
//     });
// });

// /**
//  * /clear-downloads endpoint’i
//  * İndirilen dosyaları temizler.
//  */
// app.delete("/clear-downloads", (req, res) => {
//     fs.readdir(DOWNLOAD_DIR, (err, files) => {
//         if (err) return res.status(500).json({ error: "Dosyalar silinemedi." });

//         files.forEach((file) => {
//             fs.unlinkSync(path.join(DOWNLOAD_DIR, file));
//         });

//         res.json({ message: "Tüm dosyalar silindi." });
//     });
// });

// const PORT = 3000;
// app.listen(PORT, () => {
//     console.log(`🚀 Backend çalışıyor: http://localhost:${PORT}`);
// });


import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

/**
 * URL’ye göre uygun yt-dlp argümanlarını döndürür.
 */
function getDownloadArgs(url, cookiesPath = null) {
    const args = ["-o", `${DOWNLOAD_DIR}/%(title)s.%(ext)s`];

    if (url.includes("youtube.com") || url.includes("youtu.be")) {
        args.push("-f", "bv*[ext=mp4]+ba*[ext=m4a]/b[ext=mp4]", "--merge-output-format", "mp4");
    } else if (url.includes("instagram.com")) {
        args.push("-f", "best", "-S", "res:720,ext:mp4");
    } else if (url.includes("twitter.com") || url.includes("x.com")) {
        args.push("-f", "bv+ba/b", "-S", "res:720,ext:mp4");
    }

    // Çerez dosyası varsa ekle
    if (cookiesPath && fs.existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
    }

    args.push(url);
    return args;
}

/**
 * /add-to-queue endpoint’i
 * İlgili URL’e göre yt-dlp komutunu çalıştırır.
 */
app.post("/add-to-queue", (req, res) => {
    const { url, cookies } = req.body;
    if (!url) return res.status(400).json({ error: "URL gerekli." });

    // Çerezleri dosyaya kaydet (isteğe bağlı)
    const domain = new URL(url).hostname.replace("www.", "");
    const cookiePath = path.join(__dirname, `${domain}_cookies.txt`);
    if (cookies) fs.writeFileSync(cookiePath, cookies);

    const args = getDownloadArgs(url, cookiePath);
    console.log("İndirme başlatılıyor:", args.join(" "));

    const ytDlpProcess = spawn("yt-dlp", args, { shell: true });

    let output = "";
    let errorOutput = "";

    ytDlpProcess.stdout.on("data", (data) => {
        output += data.toString();
        console.log(`[yt-dlp]: ${data}`);
    });

    ytDlpProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
        console.error(`[yt-dlp hata]: ${data}`);
    });

    ytDlpProcess.on("close", (code) => {
        if (code === 0) {
            console.log("✅ İndirme tamamlandı!");
            res.json({ message: "İndirme tamamlandı.", output });
        } else {
            console.error("❌ İndirme başarısız oldu!");
            res.status(500).json({ message: "İndirme başarısız oldu.", error: errorOutput });
        }
    });
});

/**
 * /list-downloads endpoint’i
 * İndirilen dosyaları listeler.
 */
app.get("/list-downloads", (req, res) => {
    fs.readdir(DOWNLOAD_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: "Dosyalar listelenemedi." });
        }
        res.json({ files });
    });
});

/**
 * /clear-downloads endpoint’i
 * İndirilen dosyaları temizler.
 */
app.delete("/clear-downloads", (req, res) => {
    fs.readdir(DOWNLOAD_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: "Dosyalar silinemedi." });

        files.forEach((file) => {
            fs.unlinkSync(path.join(DOWNLOAD_DIR, file));
        });

        res.json({ message: "Tüm dosyalar silindi." });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend çalışıyor: http://localhost:${PORT}`);
});
