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

dotenv.config();

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());

const frontendPath = path.join(__dirname, "public");
app.use(express.static(frontendPath));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
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

// --- IN-MEMORY MOCK DB ---
const IN_MEMORY_DB = {
  users: [],
  bookings: [],
  archivedBookings: []
};

// Auto-inject an Admin Account and Mock Data for testing
(async () => {
    IN_MEMORY_DB.users.push({
        id: "admin-1",
        email: "admin@flow.com",
        name: "Super Admin",
        passwordHash: await bcrypt.hash("admin", 10),
        role: "ADMIN"
    });
})();

let SEAT_PRICE = 50; 

// --- REAL GPS TRACKING LOGIC ---
const STADIUM_LAT = 40.7128; // Using New York as Mock Base
const STADIUM_LNG = -74.0060;

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
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(dp/2) * Math.sin(dp/2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function calculateActualCrowsMath() {
  const deviceLocations = Object.values(connectedDevicesGPS);
  
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
          
          // Determine congestion logically
          if (z.activeDevices < 2) { 
              z.congestionLevel = 'low'; 
              z.waitTime = z.activeDevices * 1; 
          } else if (z.activeDevices <= 5) { 
              z.congestionLevel = 'medium'; 
              z.waitTime = z.activeDevices * 2; 
          } else { 
              z.congestionLevel = 'high'; 
              z.waitTime = z.activeDevices * 3; 
          }
      }
      return z;
  });
  io.emit("venue_update", ZONES);
}

io.on("connection", (socket) => {
  socket.emit("venue_update", ZONES);
  
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

    const existing = IN_MEMORY_DB.users.find(u => u.email === email);
    if (existing) return res.status(400).json({ error: "User already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = { id: Date.now().toString(), email, name, passwordHash, role: "USER" };
    IN_MEMORY_DB.users.push(newUser);

    const token = jwt.sign({ id: newUser.id, role: newUser.role }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
    res.json({ token, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role } });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = IN_MEMORY_DB.users.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
    req.userId = decoded.id;
    next();
  } catch(e) {
    res.status(403).json({ error: "Invalid token" });
  }
};

const requireAdmin = (req, res, next) => {
  const user = IN_MEMORY_DB.users.find(u => u.id === req.userId);
  if (user && user.role === "ADMIN") next();
  else res.status(403).json({ error: "Forbidden: Admin only" });
};

// --- ADMIN FEATURES: Crowd Override & Broadcast ---
app.post("/api/admin/zone-update", requireAuth, requireAdmin, (req, res) => {
    const { id, waitTime, congestionLevel, manualOverride } = req.body;
    const zoneIndex = ZONES.findIndex(z => z.id === id);
    if (zoneIndex > -1) {
        if(waitTime !== undefined) ZONES[zoneIndex].waitTime = waitTime;
        if(congestionLevel !== undefined) ZONES[zoneIndex].congestionLevel = congestionLevel;
        if(manualOverride !== undefined) ZONES[zoneIndex].manualOverride = manualOverride;
        io.emit("venue_update", ZONES);
        return res.json({ message: "Zone updated successfully", zone: ZONES[zoneIndex] });
    }
    res.status(404).json({ error: "Zone not found" });
});

app.post("/api/admin/broadcast", requireAuth, requireAdmin, (req, res) => {
    const { message, source } = req.body;
    if(!message) return res.status(400).json({ error: "Message required" });
    const notification = {
        id: Date.now().toString(),
        source: source || "Government Notification",
        message: message,
        timestamp: new Date()
    };
    io.emit("official_broadcast", notification);
    res.json({ success: true, notification });
});


// --- SEATS & SECURE PAYMENTS ---
const generateSeatMap = () => {
    let map = [];
    const rows = ['A','B','C','D','E','F','G','H','I','J']; 
    for(const r of rows) {
        for(let i=1; i<=10; i++) {
            // Determine nearest gate
            let gate = (['A','B','C','D','E'].includes(r)) ? "North Entry Gate" : "South Entry Gate";
            map.push({ id: `${r}${i}`, row: r, number: i, nearestGate: gate });
        }
    }
    return map;
};
const SEAT_MAP = generateSeatMap();

app.get("/api/seats", requireAuth, (req, res) => {
   const mappedSeats = SEAT_MAP.map(seat => {
       const isBooked = IN_MEMORY_DB.bookings.some(b => b.seat === seat.id);
       return { ...seat, status: isBooked ? 'occupied' : 'empty' };
   });
   res.json({ currentPrice: SEAT_PRICE, seats: mappedSeats });
});

app.post("/api/admin/price", requireAuth, requireAdmin, (req, res) => {
    const { newPrice } = req.body;
    if (newPrice !== undefined && newPrice > 0) {
        SEAT_PRICE = Number(newPrice);
        io.emit('price_update', SEAT_PRICE);
        return res.json({ message: "Global pricing successfully updated!", newPrice: SEAT_PRICE });
    }
    res.status(400).json({ error: "Invalid price provided." });
});

app.post("/api/payment", requireAuth, (req, res) => {
   const { venueId, passengers, cardDetails } = req.body; 
   // Photo stripped from payload expectations
   
   if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
       return res.status(400).json({ error: "No passenger data provided."});
   }

   const user = IN_MEMORY_DB.users.find(u => u.id === req.userId);
   
   if (user.role !== 'ADMIN') {
       if (!cardDetails || !cardDetails.number) {
           return res.status(400).json({ error: "Missing secure payment credentials." });
       }
   }

   // Validation: ALL passengers must have PII filled (Except Photo now)
   for(let p of passengers) {
       if(!p.seat || !p.name || !p.age || !p.gender || !p.contact || !p.address) {
           return res.status(400).json({ error: `Missing complete details for seat ${p.seat}`});
       }
   }

   const sniped = passengers.find(p => IN_MEMORY_DB.bookings.some(b => b.seat === p.seat));
   if(sniped) return res.status(400).json({ error: `Seat ${sniped.seat} was already booked!`});

   const newBookings = [];
   const bookingIdGroup = "GRP-" + Date.now().toString();

   passengers.forEach(p => {
       const seatDetail = SEAT_MAP.find(s => s.id === p.seat);
       const gate = seatDetail ? seatDetail.nearestGate : 'Unknown';

       const b = {
           id: "BK-" + Date.now().toString() + "-" + p.seat,
           groupId: bookingIdGroup,
           userId: user.role === 'ADMIN' ? null : req.userId,
           bookedByAdminId: user.role === 'ADMIN' ? req.userId : null,
           venueId: venueId || "venue-1",
           seat: p.seat,
           nearestGate: gate,
           pricePaid: SEAT_PRICE,
           createdAt: new Date(),
           // Secure Data Storage - Encrypting PII
           passengerEncrypted: {
               name: encryptPII(p.name),
               age: encryptPII(String(p.age)),
               gender: encryptPII(p.gender),
               contact: encryptPII(p.contact),
               address: encryptPII(p.address)
           }
       };
       IN_MEMORY_DB.bookings.push(b);
       newBookings.push(b);
       io.emit("seat_update", p.seat);
   });

   res.json({ message: `Successfully booked ${passengers.length} seats!`, bookings: newBookings });
});

app.get("/api/my-bookings", requireAuth, (req, res) => {
  const myBookings = IN_MEMORY_DB.bookings.filter(b => b.userId === req.userId).map(b => {
      return {
          id: b.id,
          seat: b.seat,
          nearestGate: b.nearestGate,
          name: decryptPII(b.passengerEncrypted.name)
      }
  });
  res.json(myBookings);
});

// ADMIN DASHBOARD
app.get("/api/admin/dashboard", requireAuth, requireAdmin, (req, res) => {
    const seatMappings = IN_MEMORY_DB.bookings.map(book => {
        let name = decryptPII(book.passengerEncrypted?.name) || "Unknown User";
        return {
            seat: book.seat,
            name: name,
            contact: decryptPII(book.passengerEncrypted?.contact) || "N/A",
            date: book.createdAt
        };
    });

    const totalRevenue = IN_MEMORY_DB.bookings.reduce((sum, b) => sum + (b.pricePaid || 50), 0);

    res.json({
        totalTicketsSold: seatMappings.length,
        totalRevenue: totalRevenue,
        seatPrice: SEAT_PRICE,
        seatMappings: seatMappings
    });
});

app.post("/api/admin/match-over", requireAuth, requireAdmin, (req, res) => {
    IN_MEMORY_DB.archivedBookings = IN_MEMORY_DB.archivedBookings || [];
    
    IN_MEMORY_DB.bookings.forEach(b => {
       IN_MEMORY_DB.archivedBookings.push({...b, archivedAt: new Date()});
    });
    
    IN_MEMORY_DB.bookings = []; 
    io.emit('seat_update'); 
    res.json({ message: "Match over. All seats are now free and data is archived." });
});

app.use((req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend server with Geolocation GPS Tracking running on port ${PORT}`);
});
