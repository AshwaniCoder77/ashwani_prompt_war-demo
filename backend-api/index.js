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
const fs = require("fs");
const { OAuth2Client, GoogleAuth } = require('google-auth-library');
const admin = require('firebase-admin');

dotenv.config();

// --- FIREBASE INITIALIZATION ---
if (process.env.NODE_ENV === "production") {
    console.log("Using Application Default Credentials for Firestore (Cloud Environment).");
    admin.initializeApp();
} else {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
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
          "https://accounts.google.com"
        ],
        connectSrc: [
          "'self'",
          "https://maps.googleapis.com",
          "https://www.google.com",
          "https://accounts.google.com"
        ],
        imgSrc: [
          "'self'", 
          "data:", 
          "blob:",
          "https://maps.gstatic.com", 
          "https://maps.googleapis.com",
          "https://*.ggpht.com"
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://fonts.googleapis.com"],
        frameSrc: [
          "'self'",
          "https://www.google.com",
          "https://accounts.google.com"
        ]
      },
    },
  })
);
app.use(express.json());

const frontendPath = path.join(__dirname, "public");
app.use(express.static(frontendPath));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: "Too many requests, please try again later." }
});
app.use("/api/", apiLimiter);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- SECURITY: ENCRYPTION FOR PII ---
const ENCRYPTION_KEY = crypto.scryptSync(process.env.PII_SECRET || "secure_pass_phrase_for_pii", "salt", 32);
const IV_LENGTH = 16;
function encryptPII(text) {
    if (!text) return text;
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}
function decryptPII(text) {
    if (!text) return text;
    try {
        let textParts = text.split(':');
        let iv = Buffer.from(textParts.shift(), 'hex');
        let encryptedText = Buffer.from(textParts.join(':'), 'hex');
        let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        return text;
    }
}

// --- RECAPTCHA ENTERPRISE VERIFICATION ---
async function createAssessment(token) {
    const projectId = process.env.RECAPTCHA_PROJECT_ID || "prompt-war-492920";
    const siteKey = process.env.RECAPTCHA_SITE_KEY || "6Ld7pb4sAAAAAKdIn1hceH9fxd9iJj03LORY5yWn";

    if (!token) return null;

    try {
        const authOptions = { scopes: 'https://www.googleapis.com/auth/cloud-platform' };
        if (process.env.NODE_ENV !== "production") {
            authOptions.keyFile = path.join(__dirname, 'serviceAccountKey.json');
        }
        const auth = new GoogleAuth(authOptions);
        const client = await auth.getClient();
        const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments`;

        const response = await client.request({
            url,
            method: 'POST',
            data: {
                event: {
                    token: token,
                    siteKey: siteKey,
                    expectedAction: 'payment'
                }
            }
        });

        return response.data;
    } catch (e) {
        console.error("reCAPTCHA Assessment Internal Error:", e.message);
        return null;
    }
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "666422970821-g87nbhojue4h457h8rp14cjt781reh63.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Ensure Admin account exists in Firestore
(async () => {
    try {
        const adminRef = db.collection('users').doc('admin-1');
        const doc = await adminRef.get();
        if (!doc.exists) {
            await adminRef.set({
                id: "admin-1",
                email: "admin@flow.com",
                name: "Super Admin",
                passwordHash: await bcrypt.hash("admin", 10),
                role: "ADMIN"
            });
            console.log("Admin account created in Firestore.");
        }
    } catch (e) {
        console.error("Firestore Admin Init Error:", e);
    }
})();

let SEAT_PRICE = 50;
// Load settings from Firestore
(async () => {
    try {
        const settingsRef = db.collection('settings').doc('pricing');
        const doc = await settingsRef.get();
        if (doc.exists) {
            SEAT_PRICE = doc.data().seatPrice;
            console.log("Loaded SEAT_PRICE from Firestore:", SEAT_PRICE);
        } else {
            await settingsRef.set({ seatPrice: 50 });
        }
    } catch (e) {
        console.error("Settings Load Error", e);
    }
})();

let BROADCASTS = [];
(async () => {
    try {
        const snapshot = await db.collection('broadcasts').orderBy('timestamp', 'desc').get();
        snapshot.forEach(doc => {
            const data = doc.data();
            data.timestamp = data.timestamp.toDate ? data.timestamp.toDate() : data.timestamp;
            BROADCASTS.push(data);
        });
    } catch (e) {
        console.error("Broadcasts Load Error", e);
    }
})();

// --- REAL GPS TRACKING LOGIC ---
const STADIUM_LAT = 28.582875; // Plus Code: H6MM+5P9, New Delhi
const STADIUM_LNG = 77.234375;

let ZONES = [
    { id: "north-gate", type: "gate", name: "North Entry Gate", congestionLevel: "low", waitTime: 0, activeDevices: 0, lat: STADIUM_LAT + 0.002, lng: STADIUM_LNG, radius: 100 },
    { id: "south-gate", type: "gate", name: "South Entry Gate", congestionLevel: "low", waitTime: 0, activeDevices: 0, lat: STADIUM_LAT - 0.002, lng: STADIUM_LNG, radius: 100 },
    { id: "food-court-1", type: "food", name: "Main Concourse Food", congestionLevel: "low", waitTime: 0, activeDevices: 0, lat: STADIUM_LAT, lng: STADIUM_LNG + 0.001, radius: 100 },
    { id: "food-court-2", type: "food", name: "East Side Taco Stand", congestionLevel: "low", waitTime: 0, activeDevices: 0, lat: STADIUM_LAT, lng: STADIUM_LNG - 0.001, radius: 100 },
    { id: "washroom-a", type: "washroom", name: "Washroom Block A", congestionLevel: "low", waitTime: 0, activeDevices: 0, lat: STADIUM_LAT + 0.001, lng: STADIUM_LNG + 0.001, radius: 80 },
    { id: "washroom-b", type: "washroom", name: "Washroom Block B", congestionLevel: "low", waitTime: 0, activeDevices: 0, lat: STADIUM_LAT - 0.001, lng: STADIUM_LNG - 0.001, radius: 80 }
];

let connectedDevicesGPS = {}; // Tracks { socketId: { lat, lng } }

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
        Math.cos(p1) * Math.cos(p2) *
        Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateActualCrowsMath() {
    const deviceLocations = Object.values(connectedDevicesGPS);
    const currentHour = new Date().getHours();
    // Predictive modifier based on hour (e.g. 18-21:00 is peak)
    const peakModifier = (currentHour >= 18 && currentHour <= 21) ? 1.5 : 1.0;

    ZONES = ZONES.map(z => {
        if (!z.manualOverride) {
            // Count devices strictly within the geographic radius of this zone
            let count = 0;
            for (let loc of deviceLocations) {
                const distance = getDistanceInMeters(loc.lat, loc.lng, z.lat, z.lng);
                if (distance <= z.radius) {
                    count++;
                }
            }
            z.activeDevices = count;

            z.historicalTrend = z.historicalTrend || [];
            z.historicalTrend.push(count);
            if (z.historicalTrend.length > 5) z.historicalTrend.shift();

            const avgDevices = z.historicalTrend.reduce((a, b) => a + b, 0) / z.historicalTrend.length;
            let predictedLoad = Math.max(z.activeDevices, avgDevices) * peakModifier;

            // Determine congestion logically
            if (predictedLoad < 2) {
                z.congestionLevel = 'low';
                z.waitTime = Math.ceil(predictedLoad * 1.5);
            } else if (predictedLoad <= 5) {
                z.congestionLevel = 'medium';
                z.waitTime = Math.ceil(predictedLoad * 2.5);
            } else {
                z.congestionLevel = 'high';
                z.waitTime = Math.ceil(predictedLoad * 4.0);
            }
        }
        return z;
    });
    io.emit("venue_update", ZONES);
}

io.on("connection", (socket) => {
    socket.emit("venue_update", ZONES);
    socket.emit("all_broadcasts", BROADCASTS);

    socket.on("update_location", (coords) => {
        if (coords && coords.lat && coords.lng) {
            connectedDevicesGPS[socket.id] = { lat: coords.lat, lng: coords.lng };
        }
    });

    socket.on("disconnect", () => {
        delete connectedDevicesGPS[socket.id];
    });
});

// Update crowd calculations frequently based on exact GPS feeds
setInterval(calculateActualCrowsMath, 3000);


// --- REST ROUTES ---
app.post("/api/register", async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Missing fields" });

        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();
        if (!snapshot.empty) return res.status(400).json({ error: "User already exists" });

        const passwordHash = await bcrypt.hash(password, 10);
        const id = Date.now().toString();
        const newUser = { id, email, name, passwordHash, role: "USER" };
        await usersRef.doc(id).set(newUser);

        const token = jwt.sign({ id, role: "USER" }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
        res.json({ token, user: { id, email, name, role: "USER" } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();
        if (snapshot.empty) return res.status(404).json({ error: "User not found" });

        const user = snapshot.docs[0].data();
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return res.status(401).json({ error: "Invalid password" });

        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
        res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/google-login", async (req, res) => {
    try {
        const { credential } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email;
        const name = payload.name;

        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();
        let user;
        if (snapshot.empty) {
            const id = Date.now().toString();
            user = { id, email, name, passwordHash: "GOOGLE_OAUTH", role: "USER" };
            await usersRef.doc(id).set(user);
        } else {
            user = snapshot.docs[0].data();
        }

        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
        res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (e) {
        res.status(401).json({ error: "Invalid Google Token" });
    }
});

const requireAuth = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
        req.userId = decoded.id;

        const userDoc = await db.collection('users').doc(req.userId).get();
        if (!userDoc.exists) return res.status(401).json({ error: "Session Expired (User not found). Please log out and register again." });

        req.user = userDoc.data();
        next();
    } catch (e) {
        res.status(403).json({ error: "Invalid token" });
    }
};

const requireAdmin = async (req, res, next) => {
    if (req.user && req.user.role === "ADMIN") next();
    else res.status(403).json({ error: "Forbidden: Admin only" });
};

// --- ADMIN FEATURES: Crowd Override & Broadcast ---
app.post("/api/admin/zone-update", requireAuth, requireAdmin, (req, res) => {
    const { id, waitTime, congestionLevel, manualOverride } = req.body;
    const zoneIndex = ZONES.findIndex(z => z.id === id);
    if (zoneIndex > -1) {
        if (waitTime !== undefined) ZONES[zoneIndex].waitTime = waitTime;
        if (congestionLevel !== undefined) ZONES[zoneIndex].congestionLevel = congestionLevel;
        if (manualOverride !== undefined) ZONES[zoneIndex].manualOverride = manualOverride;
        io.emit("venue_update", ZONES);
        return res.json({ message: "Zone updated successfully", zone: ZONES[zoneIndex] });
    }
    res.status(404).json({ error: "Zone not found" });
});

app.post("/api/admin/broadcast", requireAuth, requireAdmin, async (req, res) => {
    const { message, source } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    const notification = {
        id: Date.now().toString(),
        source: source || "Government Notification",
        message: message,
        timestamp: new Date()
    };
    
    try {
        await db.collection('broadcasts').doc(notification.id).set(notification);
        BROADCASTS.unshift(notification);
        io.emit("official_broadcast", notification);
        res.json({ success: true, notification });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// --- SEATS & SECURE PAYMENTS ---
const generateSeatMap = () => {
    let map = [];
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    for (const r of rows) {
        for (let i = 1; i <= 10; i++) {
            // Determine nearest gate, food court, and washroom
            let isNorth = ['A', 'B', 'C', 'D', 'E'].includes(r);
            let gate = isNorth ? "North Entry Gate" : "South Entry Gate";
            let foodCourt = (i <= 5) ? "East Side Taco Stand" : "Main Concourse Food";
            let washroom = isNorth ? "Washroom Block A" : "Washroom Block B";

            map.push({
                id: `${r}${i}`,
                row: r,
                number: i,
                nearestGate: gate,
                nearestFoodCourt: foodCourt,
                nearestWashroom: washroom
            });
        }
    }
    return map;
};
const SEAT_MAP = generateSeatMap();

app.get("/api/seats", requireAuth, async (req, res) => {
    try {
        const bookingsSnapshot = await db.collection('bookings').get();
        const bookedSeatIds = bookingsSnapshot.docs.map(doc => doc.data().seat);

        const mappedSeats = SEAT_MAP.map(seat => {
            const isBooked = bookedSeatIds.includes(seat.id);
            return { ...seat, status: isBooked ? 'occupied' : 'empty' };
        });
        res.json({ currentPrice: SEAT_PRICE, seats: mappedSeats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/admin/price", requireAuth, requireAdmin, async (req, res) => {
    const { newPrice } = req.body;
    if (newPrice !== undefined && newPrice > 0) {
        SEAT_PRICE = Number(newPrice);
        await db.collection('settings').doc('pricing').set({ seatPrice: SEAT_PRICE });
        io.emit('price_update', SEAT_PRICE);
        return res.json({ message: "Global pricing successfully updated!", newPrice: SEAT_PRICE });
    }
    res.status(400).json({ error: "Invalid price provided." });
});

app.post("/api/payment", requireAuth, async (req, res) => {
    const { venueId, passengers, cardDetails, recaptchaToken } = req.body;

    if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
        return res.status(400).json({ error: "No passenger data provided." });
    }

    const user = req.user;
    if (user.role !== 'ADMIN') {
        if (!cardDetails || !cardDetails.number) {
            return res.status(400).json({ error: "Missing secure payment credentials." });
        }
    }

    try {
        // BOT MITIGATION: reCAPTCHA Enterprise Verification
        const assessment = await createAssessment(recaptchaToken);
        console.log("Assessment Result:", JSON.stringify(assessment, null, 2));
        
        if (!assessment || !assessment.tokenProperties || !assessment.tokenProperties.valid) {
            console.warn(`[SECURITY] Invalid reCAPTCHA attempt for user ${req.user.email}`);
            console.warn(`[SECURITY] REASON:`, assessment?.tokenProperties?.invalidReason);
            return res.status(403).json({ error: "Security check failed. Please refresh and try again." });
        }

        if (assessment.riskAnalysis && assessment.riskAnalysis.score < 0.5) {
            console.warn(`[SECURITY] Bot Blocking triggered for user ${req.user.email}. Score: ${assessment.riskAnalysis.score}`);
            return res.status(403).json({ error: "Automated traffic detected. Booking blocked for security." });
        }

        const bookingsRef = db.collection('bookings');

        // Validation: ALL passengers must have PII filled
        for (let p of passengers) {
            if (!p.seat || !p.name || !p.age || !p.gender || !p.contact || !p.address) {
                return res.status(400).json({ error: `Missing complete details for seat ${p.seat}` });
            }
        }

        // Verify seats are not already booked
        const seatsInvolved = passengers.map(p => p.seat);
        const conflictsSnapshot = await bookingsRef.where('seat', 'in', seatsInvolved).get();

        if (!conflictsSnapshot.empty) {
            const taken = conflictsSnapshot.docs.map(doc => doc.data().seat);
            return res.status(400).json({ error: `Seats ${taken.join(', ')} were already booked!` });
        }

        const newBookings = [];
        const bookingIdGroup = "GRP-" + Date.now().toString();
        const batch = db.batch();

        passengers.forEach(p => {
            const seatDetail = SEAT_MAP.find(s => s.id === p.seat);
            const gate = seatDetail ? seatDetail.nearestGate : 'Unknown';
            const foodCourt = seatDetail ? seatDetail.nearestFoodCourt : 'Unknown';
            const washroom = seatDetail ? seatDetail.nearestWashroom : 'Unknown';
            let assignedEmail = user.role === 'ADMIN' ? p.userEmail : user.email;
            const bookingId = "BK-" + Date.now().toString() + "-" + p.seat;

            const b = {
                id: bookingId,
                groupId: bookingIdGroup,
                userId: user.role === 'ADMIN' ? null : req.userId,
                bookedByAdminId: user.role === 'ADMIN' ? req.userId : null,
                userEmail: assignedEmail,
                venueId: venueId || "venue-1",
                seat: p.seat,
                nearestGate: gate,
                nearestFoodCourt: foodCourt,
                nearestWashroom: washroom,
                pricePaid: SEAT_PRICE,
                createdAt: new Date(),
                passengerEncrypted: {
                    name: encryptPII(p.name),
                    age: encryptPII(String(p.age)),
                    gender: encryptPII(p.gender),
                    contact: encryptPII(p.contact),
                    address: encryptPII(p.address)
                }
            };
            const docRef = bookingsRef.doc(bookingId);
            batch.set(docRef, b);
            newBookings.push(b);
        });

        await batch.commit();
        io.emit("seat_update");
        res.json({ message: `Successfully booked ${passengers.length} seats!`, bookings: newBookings });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get("/api/my-bookings", requireAuth, async (req, res) => {
    try {
        const user = req.user;
        const bookingsRef = db.collection('bookings');

        const q1 = await bookingsRef.where('userId', '==', req.userId).get();
        const q2 = await bookingsRef.where('userEmail', '==', user.email).get();

        const resultsMap = new Map();
        q1.forEach(doc => resultsMap.set(doc.id, doc.data()));
        q2.forEach(doc => resultsMap.set(doc.id, doc.data()));

        const myBookings = Array.from(resultsMap.values()).map(b => {
            return {
                id: b.id,
                seat: b.seat,
                nearestGate: b.nearestGate,
                nearestFoodCourt: b.nearestFoodCourt,
                nearestWashroom: b.nearestWashroom,
                name: decryptPII(b.passengerEncrypted.name)
            }
        });
        res.json(myBookings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ADMIN DASHBOARD
app.get("/api/admin/dashboard", requireAuth, requireAdmin, async (req, res) => {
    try {
        const bookingsSnapshot = await db.collection('bookings').get();
        const records = bookingsSnapshot.docs.map(doc => doc.data());

        const seatMappings = records.map(book => {
            let name = decryptPII(book.passengerEncrypted?.name) || "Unknown User";
            return {
                seat: book.seat,
                name: name,
                contact: decryptPII(book.passengerEncrypted?.contact) || "N/A",
                date: book.createdAt?.toDate ? book.createdAt.toDate() : book.createdAt
            };
        });

        const totalRevenue = records.reduce((sum, b) => sum + (b.pricePaid || 50), 0);

        res.json({
            totalTicketsSold: seatMappings.length,
            totalRevenue: totalRevenue,
            seatPrice: SEAT_PRICE,
            seatMappings: seatMappings
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/admin/match-over", requireAuth, requireAdmin, async (req, res) => {
    try {
        const bookingsSnapshot = await db.collection('bookings').get();
        const batch = db.batch();
        const archivedRef = db.collection('archivedBookings');

        if (!bookingsSnapshot.empty) {
            bookingsSnapshot.docs.forEach(doc => {
                const data = doc.data();
                const archiveDoc = archivedRef.doc(doc.id);
                batch.set(archiveDoc, { ...data, archivedAt: new Date() });
                batch.delete(doc.ref);
            });
        }

        const broadcastsSnapshot = await db.collection('broadcasts').get();
        if (!broadcastsSnapshot.empty) {
            broadcastsSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
        }
        BROADCASTS = [];

        await batch.commit();
        io.emit('seat_update');
        io.emit('all_broadcasts', BROADCASTS);
        res.json({ message: "Match over. All seats are now free and data is archived in Firestore." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

const PORT = parseInt(process.env.PORT) || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server with Geolocation GPS Tracking running on port ${PORT}`);
});
