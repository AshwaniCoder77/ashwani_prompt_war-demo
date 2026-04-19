const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const crypto = require("crypto");
const { OAuth2Client, GoogleAuth } = require('google-auth-library');
const admin = require('firebase-admin');

dotenv.config();

// --- FIREBASE INIT ---
try {
  const serviceAccount = require('./serviceAccountKey.json');
  if (Object.keys(serviceAccount).length > 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else throw new Error();
} catch {
  const serviceAccount = require("./serviceAccountKey.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}
const db = admin.firestore();

const app = express();
app.use(cors());

/* ================== ✅ FIXED HELMET CSP ================== */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://www.google.com",
          "https://www.gstatic.com",
          "https://maps.googleapis.com",
          "https://maps.gstatic.com"
        ],

        connectSrc: [
          "'self'",
          "https://maps.googleapis.com",
          "https://maps.gstatic.com",
          "https://www.google.com"
        ],

        imgSrc: [
          "'self'",
          "data:",
          "https://maps.gstatic.com",
          "https://maps.googleapis.com"
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'"
        ],

        mediaSrc: [
          "'self'",
          "data:"
        ],

        frameSrc: [
          "'self'",
          "https://www.google.com"
        ]
      }
    }
  })
);
/* ======================================================== */

app.use(express.json());

const frontendPath = path.join(__dirname, "public");
app.use(express.static(frontendPath));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

/* ================== SECURITY ================== */
const ENCRYPTION_KEY = crypto.scryptSync(process.env.PII_SECRET || "secret", "salt", 32);
const IV_LENGTH = 16;

function encryptPII(text) {
  if (!text) return text;
  let iv = crypto.randomBytes(IV_LENGTH);
  let cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}
/* ============================================ */

/* ================== RECAPTCHA ================== */
async function createAssessment(token) {
  if (!token) return null;

  const auth = new GoogleAuth({
    keyFile: path.join(__dirname, 'serviceAccountKey.json'),
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });

  const client = await auth.getClient();

  return await client.request({
    url: `https://recaptchaenterprise.googleapis.com/v1/projects/${process.env.RECAPTCHA_PROJECT_ID}/assessments`,
    method: 'POST',
    data: {
      event: {
        token: token,
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        expectedAction: 'payment'
      }
    }
  });
}
/* ============================================== */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/* ================== ROUTES ================== */
app.post("/api/payment", async (req, res) => {
  try {
    const { recaptchaToken } = req.body;

    const assessment = await createAssessment(recaptchaToken);

    if (!assessment || !assessment.data.tokenProperties.valid) {
      return res.status(403).json({ error: "reCAPTCHA failed" });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
/* ============================================ */

app.use((req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});