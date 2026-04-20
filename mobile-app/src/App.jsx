import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Map, Bell, User, Ticket, CreditCard, X, ShieldAlert, Navigation, Settings2, MessageSquareWarning, MapPin, Navigation2 } from 'lucide-react';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';

const MAPS_API_KEY = import.meta.env.VITE_MAPS_API_KEY || "AIzaSyA8JducfWX7J2-yUkkLFuwUeeVdsWsXxqA";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "666422970821-g87nbhojue4h457h8rp14cjt781reh63.apps.googleusercontent.com";
const stadiumLocation = { lat: 28.582875, lng: 77.234375 };
const mapContainerStyle = { width: '100%', height: '300px', borderRadius: '12px', marginTop: '16px', border: '1px solid rgba(255,255,255,0.1)' };

const IS_PROD = window.location.hostname !== 'localhost';
const API_URL = IS_PROD ? '/api' : 'http://localhost:4000/api';
const SOCKET_URL = IS_PROD ? '' : 'http://localhost:4000';

function App() {
  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: MAPS_API_KEY });

  const [zones, setZones] = useState([]);
  const [seats, setSeats] = useState([]);

  const [activeTab, setActiveTab] = useState('map');
  const [socketConnected, setSocketConnected] = useState(false);
  const [userLocation, setUserLocation] = useState(null);

  // Auth State
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [userRole, setUserRole] = useState(localStorage.getItem('userRole'));
  const [isRegistering, setIsRegistering] = useState(false);
  const [bookings, setBookings] = useState([]);

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  // Payment Selection State (Array)
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [seatPrice, setSeatPrice] = useState(50); // Dynamic from backend
  const [adminPriceInput, setAdminPriceInput] = useState('');

  // Multi-seat Passenger State
  const [passengers, setPassengers] = useState([]);

  const [cardNum, setCardNum] = useState('');
  const [cardExp, setCardExp] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  const [isProcessing, setIsProcessing] = useState(false);

  // Broadcasts
  const [broadcasts, setBroadcasts] = useState([]);
  const [broadcastMsg, setBroadcastMsg] = useState('');

  // Admin State
  const [adminData, setAdminData] = useState(null);
  const [zoneUpdates, setZoneUpdates] = useState({});

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socket.on('connect', () => setSocketConnected(true));
    socket.on('venue_update', (data) => setZones(data));
    socket.on('seat_update', () => fetchSeats());
    socket.on('price_update', (newPrice) => setSeatPrice(newPrice));
    socket.on('all_broadcasts', (msgs) => setBroadcasts(msgs));
    socket.on('official_broadcast', (msg) => {
      setBroadcasts(prev => [msg, ...prev]);
      if (activeTab !== 'inbox' && userRole !== 'ADMIN') {
        alert(`New Government/Official Broadcast: ${msg.message}`);
      }
    });

    // --- Enable Browser GPS Locational Tracking ---
    let watchId;
    if ("geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
          socket.emit("update_location", loc);
        },
        (err) => console.log("GPS Track Err: ", err),
        { enableHighAccuracy: true }
      );
    }

    socket.on('disconnect', () => setSocketConnected(false));
    return () => {
      socket.disconnect();
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab, userRole]);

  useEffect(() => {
    if (window.gtag && zones && zones.length > 0) {
      zones.forEach(z => {
        window.gtag('event', 'congestion_prediction', {
          'zone_id': z.id,
          'wait_time': z.waitTime,
          'congestion_level': z.congestionLevel
        });
      });
    }
  }, [zones]);

  useEffect(() => {
    // Hardware Detection for adaptive animations/render performance
    const isLowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) ||
      (navigator.deviceMemory && navigator.deviceMemory < 4);
    if (isLowEnd) {
      document.body.classList.add('low-end-device');
    }
  }, []);

  useEffect(() => {
    if (token) {
      setUser({ email: localStorage.getItem('userEmail') || 'User' });
      fetchBookings();
      fetchSeats();
      if (userRole === "ADMIN") fetchAdminData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab]);

  const fetchBookings = async () => {
    try {
      const res = await fetch(`${API_URL}/my-bookings`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setBookings(await res.json());
      else if (res.status === 401 || res.status === 403) logout();
    } catch (e) { console.error(e); }
  };

  const fetchSeats = async () => {
    try {
      const res = await fetch(`${API_URL}/seats`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSeats(data.seats);
        setSeatPrice(data.currentPrice);
      } else if (res.status === 401 || res.status === 403) logout();
    } catch (e) { console.error(e); }
  };

  const fetchAdminData = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setAdminData(await res.json());
      else if (res.status === 401 || res.status === 403) logout();
    } catch (e) { console.error(e); }
  }

  const handleAuth = async (e) => {
    e.preventDefault();
    const endpoint = isRegistering ? 'register' : 'login';
    const payload = isRegistering ? { email, password, name } : { email, password };

    try {
      const res = await fetch(`${API_URL}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setUser(data.user);
        setUserRole(data.user.role);
        localStorage.setItem('token', data.token);
        localStorage.setItem('userEmail', data.user.email);
        localStorage.setItem('userRole', data.user.role || 'USER');
      } else alert(data.error);
    } catch (e) {
      console.error(e);
      alert("Error reaching server");
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const res = await fetch(`${API_URL}/google-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialResponse.credential })
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setUser(data.user);
        setUserRole(data.user.role);
        localStorage.setItem('token', data.token);
        localStorage.setItem('userEmail', data.user.email);
        localStorage.setItem('userRole', data.user.role || 'USER');
      } else { alert(data.error); }
    } catch (e) {
      console.error(e);
      alert('Failed to authenticate with Google on backend.');
    }
  };

  const logout = () => {
    setToken(null); setUser(null); setUserRole(null);
    localStorage.clear();
  };

  // Open Checkout Modal
  const openCheckout = () => {
    const initialPassengers = selectedSeats.map(seat => ({
      seat, name: '', age: '', gender: 'Male', contact: '', address: '', userEmail: ''
    }));
    setPassengers(initialPassengers);
    setShowPaymentModal(true);
  }

  const toggleSeat = (seatId) => {
    setSelectedSeats(prev => prev.includes(seatId) ? prev.filter(id => id !== seatId) : [...prev, seatId]);
  };

  const handlePassengerChange = (index, field, value) => {
    setPassengers(prev => {
      const arr = [...prev];
      arr[index][field] = value;
      return arr;
    });
  }

  const processSecurePayment = async (e) => {
    e.preventDefault();
    setIsProcessing(true);

    try {
      // reCAPTCHA Enterprise Execution
      if (typeof window.grecaptcha === 'undefined') {
        throw new Error("reCAPTCHA script not loaded yet.");
      }

      window.grecaptcha.enterprise.ready(async () => {
        try {
          const recaptchaToken = await window.grecaptcha.enterprise.execute('6Ld7pb4sAAAAAKdIn1hceH9fxd9iJj03LORY5yWn', { action: 'payment' });
          
          const payloadBody = { 
            venueId: "venue-1", 
            passengers: passengers, 
            cardDetails: { number: cardNum },
            recaptchaToken: recaptchaToken 
          };

          const res = await fetch(`${API_URL}/payment`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payloadBody)
          });

          const data = await res.json();
          setIsProcessing(false);

          if (res.ok) {
            setShowPaymentModal(false);
            setSelectedSeats([]);
            setCardNum(''); setCardExp(''); setCardCvv('');
            fetchBookings(); fetchSeats();
            alert(`Success! Booked ${data.bookings.length} seats. Security Details Encrypted.`);
          } else {
            alert("Transaction Failed: " + data.error);
          }
        } catch (err) {
          setIsProcessing(false);
          alert("Security verification failed: " + err.message);
        }
      });

    } catch (e) {
      setIsProcessing(false);
      alert("Payment Checkout failed: " + e.message);
    }
  };

  // Admin Broadcast
  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return alert("Enter message to broadcast");
    try {
      const res = await fetch(`${API_URL}/admin/broadcast`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: broadcastMsg, source: "Stadium Security Gov" })
      });
      if (res.ok) {
        setBroadcastMsg('');
        alert("Broadcast sent via WebSockets!");
      } else {
        const data = await res.json();
        alert("Broadcast failed: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      alert("Network error while broadcasting");
    }
  };

  // Admin Crowd Update
  const updateZone = async (zoneId) => {
    const update = zoneUpdates[zoneId] || {};
    if (Object.keys(update).length === 0) return alert("Change values before updating");
    update.manualOverride = true;
    try {
      const res = await fetch(`${API_URL}/admin/zone-update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id: zoneId, ...update })
      });
      if (res.ok) {
        alert("Zone Manually Updated. UI dynamically routing users!");
        fetchSeats(); // Refresh map
      } else {
        const data = await res.json();
        alert("Update failed: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      alert("Network error while updating zone");
    }
  }

  const handleZoneChange = (zoneId, field, val) => {
    setZoneUpdates(prev => ({ ...prev, [zoneId]: { ...prev[zoneId], [field]: val } }));
  }

  const changeGlobalPrice = async () => {
    const parsed = Number(adminPriceInput);
    if (!parsed || parsed <= 0) return alert("Enter a valid price > ₹0");
    try {
      const res = await fetch(`${API_URL}/admin/price`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ newPrice: parsed })
      });
      if (res.ok) {
        setAdminPriceInput('');
        alert("Global Price Mechanism Updated!");
        fetchAdminData();
      } else {
        const data = await res.json();
        alert("Price update failed: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      alert("Network error while updating price");
    }
  }

  const handleMatchOver = async () => {
    if (!window.confirm("Are you sure you want to end the match? This will free all seats and archive data.")) return;
    try {
      const res = await fetch(`${API_URL}/admin/match-over`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        alert("Match ended successfully! All seats are now free.");
        fetchAdminData();
        fetchSeats();
      } else {
        const data = await res.json();
        alert("Failed to end match: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      alert("Network error while ending match");
    }
  };


    return (
      <main style={{ padding: '40px 20px', width: '100%' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '32px' }}>FlowVenue Security Phase</h1>
        <article className="glass-panel">
          <h2 style={{ marginBottom: '16px' }}>{isRegistering ? 'Create Account' : 'Log In'}</h2>
          <form onSubmit={handleAuth} aria-label={isRegistering ? "Registration Form" : "Login Form"}>
            {isRegistering && (
              <div className="form-group">
                <label htmlFor="reg-name" className="sr-only">Full Name</label>
                <input id="reg-name" className="form-input" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} />
              </div>
            )}
            <div className="form-group">
              <label htmlFor="auth-email" className="sr-only">Email</label>
              <input id="auth-email" className="form-input" type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="auth-pass" className="sr-only">Password</label>
              <input id="auth-pass" className="form-input" type="password" placeholder="Password" required value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <button className="btn-primary" type="submit">{isRegistering ? 'Sign Up' : 'Log In'}</button>
          </form>
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <span 
              role="button" 
              tabIndex="0"
              style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }} 
              onClick={() => setIsRegistering(!isRegistering)}
              onKeyDown={(e) => e.key === 'Enter' && setIsRegistering(!isRegistering)}
            >
              {isRegistering ? 'Already have an account? Log in' : "Don't have an account? Sign up"}
            </span>
          </div>

          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center' }}>
            <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => alert('Google Sign In failed')}
                theme="outline"
                shape="pill"
                text="signin_with"
                aria-label="Sign in with Google"
              />
            </GoogleOAuthProvider>
          </div>
        </article>
      </main>
    );

  return (
    <>
      <header className="app-header" role="banner">
        <div>
          <h1 style={{ marginBottom: 0 }}>FlowVenue</h1>
          <span className="subtitle">High Security Ticket & Tracking</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }} role="status" aria-live="polite">
          {userLocation ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={`Mock lat: ${userLocation.lat.toFixed(3)}, lng: ${userLocation.lng.toFixed(3)}`}>
              <MapPin size={14} color="var(--status-low)" aria-hidden="true" />
              <span style={{ fontSize: '10px', background: 'var(--status-low)', color: 'black', padding: '2px 6px', borderRadius: '4px' }}>GPS Lock OK</span>
            </div>
          ) : (
            <span style={{ fontSize: '10px', background: 'var(--text-secondary)', color: 'black', padding: '2px 6px', borderRadius: '4px' }}>No GPS</span>
          )}
          <span className="subtitle" style={{ fontSize: '10px' }}>{socketConnected ? 'LIVE' : 'CONNECTING...'}</span>
          <div className={`status-indicator ${socketConnected ? 'low' : 'high'}`} aria-hidden="true" />
        </div>
      </header>

      {showPaymentModal && (
        <section className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-content fade-in" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 id="modal-title" style={{ marginBottom: 0 }}>{userRole === "ADMIN" ? 'Proxy Assign (Admin)' : 'Secure Bulk Checkout'}</h2>
              <button aria-label="Close modal" style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }} onClick={() => setShowPaymentModal(false)}>
                <X size={24} />
              </button>
            </div>

            {userRole !== "ADMIN" && <h3 style={{ margin: '12px 0' }}>Total Cost: ₹{selectedSeats.length * seatPrice}.00</h3>}

            <p className="subtitle" style={{ marginBottom: '20px', fontSize: '0.75rem', color: 'var(--status-low)' }}>
              <CreditCard size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              High Security Requirements! Full PII requested for ALL seats.
            </p>

            <form onSubmit={processSecurePayment}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {passengers.map((p, index) => (
                  <div key={p.seat} style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px', borderLeft: '3px solid var(--accent-blue)' }}>
                    <h4 style={{ margin: '0 0 12px 0' }}>👤 Seat {p.seat} Profile</h4>

                    <div className="form-group" style={{ marginBottom: '8px' }}><input className="form-input" placeholder="Full Name" required value={p.name} onChange={e => handlePassengerChange(index, 'name', e.target.value)} /></div>
                    {userRole === "ADMIN" && (
                      <div className="form-group" style={{ marginBottom: '8px' }}><input type="email" className="form-input" placeholder="Linked User Email" required value={p.userEmail} onChange={e => handlePassengerChange(index, 'userEmail', e.target.value)} /></div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div className="form-group" style={{ flex: 1 }}><input type="number" className="form-input" placeholder="Age" required value={p.age} onChange={e => handlePassengerChange(index, 'age', e.target.value)} /></div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <select className="form-input" value={p.gender} onChange={e => handlePassengerChange(index, 'gender', e.target.value)} style={{ background: 'var(--bg-dark)', color: 'white' }}>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: '8px' }}><input type="tel" className="form-input" placeholder="Emergency Contact No." required value={p.contact} onChange={e => handlePassengerChange(index, 'contact', e.target.value)} /></div>
                    <div className="form-group" style={{ marginBottom: '8px' }}><input className="form-input" placeholder="Home Address" required value={p.address} onChange={e => handlePassengerChange(index, 'address', e.target.value)} /></div>
                  </div>
                ))}
              </div>

              {userRole !== "ADMIN" && (
                <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="form-group"><input className="form-input" placeholder="Card Number (Mock)" required value={cardNum} onChange={e => setCardNum(e.target.value)} /></div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div className="form-group" style={{ flex: 1 }}><input className="form-input" placeholder="MM/YY" required value={cardExp} onChange={e => setCardExp(e.target.value)} /></div>
                    <div className="form-group" style={{ flex: 1 }}><input className="form-input" placeholder="CVV" required type="password" maxLength={4} value={cardCvv} onChange={e => setCardCvv(e.target.value)} /></div>
                  </div>
                </div>
              )}
              <button className="btn-primary" type="submit" disabled={isProcessing} style={{ marginTop: '16px' }}>
                {isProcessing ? 'Encrypting PII & Processing...' : (userRole === "ADMIN" ? 'Deploy Admin Tickets' : `Secure Pay ₹${selectedSeats.length * seatPrice}`)}
              </button>
            </form>
          </div>
        </section>
      )}

      <main className="app-content fade-in">
        {activeTab === 'map' && (
          <div className="fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2>Live Seat Map</h2>
                <p className="subtitle" style={{ marginBottom: '10px' }}>Green = Empty. Red = Occupied.</p>
              </div>
              {selectedSeats.length > 0 && (
                <button className="btn-primary" style={{ margin: 0, width: 'auto' }} onClick={openCheckout}>
                  Checkout ({selectedSeats.length})
                </button>
              )}
            </div>

            <div className="seat-map glass-panel" style={{ marginBottom: '24px' }}>
              {seats.map(seat => {
                let cls = "seat-cell ";
                if (seat.status === 'occupied') cls += 'seat-occupied';
                else if (seat.status === 'empty' && selectedSeats.includes(seat.id)) cls += 'seat-selected';
                else cls += 'seat-empty';

                return (
                <div 
                  key={seat.id} 
                  role="button"
                  tabIndex={seat.status === 'empty' ? 0 : -1}
                  aria-label={`Seat ${seat.id}${seat.status === 'occupied' ? ' - Occupied' : selectedSeats.includes(seat.id) ? ' - Selected' : ' - Available'}`}
                  className={cls} 
                  onClick={() => {
                    if (seat.status === 'empty') toggleSeat(seat.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (seat.status === 'empty') toggleSeat(seat.id);
                    }
                  }}
                >{seat.id}</div>
                )
              })}
            </div>

            <div className="glass-panel" style={{ padding: '16px' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 12px 0' }}>
                <Navigation2 size={20} color="var(--accent-blue)" />
                Stadium Global Location
              </h3>
              {isLoaded ? (
                <GoogleMap mapContainerStyle={mapContainerStyle} center={stadiumLocation} zoom={15}>
                  <Marker position={stadiumLocation} title="FlowVenue Stadium Base" />
                </GoogleMap>
              ) : <p className="subtitle">Loading Global Map...</p>}
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2>Live Flow Alerts</h2>
                <p className="subtitle" style={{ marginBottom: '20px' }}>Crowds calculated natively through active GPS density.</p>
              </div>
              <div style={{ textAlign: 'right', paddingTop: '4px' }}>
                <span style={{ fontSize: '10px', background: 'var(--accent-blue)', color: 'black', padding: '4px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
                  Analyzed by GA4 Predictive Model
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {zones.map((z) => {
                let bgColor = 'rgba(255,255,255,0.05)';
                let borderLeft = '4px solid var(--status-low)';
                if (z.congestionLevel === 'medium') borderLeft = '4px solid var(--status-med)';
                if (z.congestionLevel === 'high') { bgColor = 'rgba(239, 68, 68, 0.1)'; borderLeft = '4px solid var(--status-high)'; }

                const betterAlternative = zones.find(alt => alt.type === z.type && alt.id !== z.id && alt.waitTime < z.waitTime);

                return (
                  <div key={z.id} className="glass-panel" style={{ background: bgColor, borderLeft }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <Bell size={20} color={`var(--status-${z.congestionLevel === 'high' ? 'high' : z.congestionLevel === 'medium' ? 'med' : 'low'})`} />
                      <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: '1rem', marginBottom: '4px' }}>{z.name} - {z.congestionLevel.toUpperCase()} CROWD</h3>
                        <p className="subtitle" style={{ marginBottom: '6px' }}>Estimated Queue Clearance: <b>{z.waitTime} minutes</b>.</p>
                        {z.manualOverride && <span style={{ fontSize: '0.65rem', background: 'var(--status-med)', color: 'black', padding: '2px 4px', borderRadius: '4px' }}>ADMIN LOCK</span>}
                        {z.congestionLevel === 'high' && betterAlternative && (
                          <p style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', marginTop: '4px' }}>
                            📍 Recommended Route: Head to <b>{betterAlternative.name}</b> (only {betterAlternative.waitTime} min wait!)
                          </p>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Navigation size={14} color="var(--text-secondary)" />
                        <br />
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{z.activeDevices} users found locally</span>
                      </div>
                    </div>
                  </div>
                )
              })}
              {zones.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No live alerts found.</p>}
            </div>
          </div>
        )}

        {activeTab === 'inbox' && (
          <div className="fade-in">
            <h2>Gov / Stadium Broadcasts</h2>
            <p className="subtitle" style={{ marginBottom: '20px' }}>Official notifications deployed securely over sockets.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {broadcasts.length === 0 ? <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No broadcasts yet.</div> :
                broadcasts.map((b) => (
                  <div key={b.id} className="glass-panel" style={{ borderLeft: '4px solid #9333ea', background: 'rgba(147, 51, 234, 0.1)' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <MessageSquareWarning size={20} color="#9333ea" />
                      <div>
                        <h3 style={{ fontSize: '1rem', marginBottom: '4px', color: "#d8b4fe" }}>{b.source}</h3>
                        <p style={{ marginBottom: '6px' }}>{b.message}</p>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{new Date(b.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="fade-in">
            <h2>{userRole === 'ADMIN' ? 'Admin Profile' : 'My Profile'}</h2>
            <div className="glass-panel" style={{ marginTop: '16px', textAlign: 'center', padding: '32px' }}>
              <User size={48} color="var(--accent-blue)" style={{ margin: '0 auto 16px auto' }} />
              <h3>{user?.email}</h3>
              <p className="subtitle">{userRole}</p>
              <button className="btn-outline" style={{ marginTop: '20px', border: '1px solid var(--status-high)', color: 'var(--status-high)' }} onClick={logout}>Log Out</button>
            </div>
            <h3 style={{ marginTop: '24px', marginBottom: '12px' }}>My Secure Bookings</h3>
            <div className="zone-grid" style={{ gridTemplateColumns: '1fr' }}>
              {bookings.length === 0 ? <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No seats booked yet.</div> :
                bookings.map((b) => {
                  const getWT = (name) => {
                    const z = zones.find(z => z.name === name);
                    return z ? `(~${z.waitTime} min)` : '';
                  };
                  return (
                    <div key={b.id} className="glass-panel" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <Ticket size={24} color="var(--accent-blue)" />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 600 }}>Stadium X - Seat {b.seat}</span>
                        <span className="subtitle" style={{ marginBottom: '6px' }}>{b.name} (PII Decrypted View)</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--status-low)', display: 'flex', alignItems: 'center', gap: '6px' }}>🚪 {b.nearestGate} <strong style={{ color: 'white' }}>{getWT(b.nearestGate)}</strong></span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--status-med)', display: 'flex', alignItems: 'center', gap: '6px' }}>🍔 {b.nearestFoodCourt} <strong style={{ color: 'white' }}>{getWT(b.nearestFoodCourt)}</strong></span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>🚻 {b.nearestWashroom} <strong style={{ color: 'white' }}>{getWT(b.nearestWashroom)}</strong></span>
                        </div>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        )}

        {activeTab === 'admin' && userRole === 'ADMIN' && (
          <div className="fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <ShieldAlert color="var(--accent-blue)" />
                <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
              </div>
              <button className="btn-primary" style={{ margin: 0, width: 'auto', padding: '8px 16px', backgroundColor: 'var(--status-high)' }} onClick={handleMatchOver}>Reset All</button>
            </div>

            <div className="glass-panel" style={{ marginBottom: '24px', background: 'rgba(147, 51, 234, 0.1)', border: '1px solid #9333ea' }}>
              <h3 style={{ color: '#d8b4fe', marginBottom: '12px' }}>Send Official Broadcast</h3>
              <textarea className="form-input" placeholder="Type government/stadium alert..." rows="3" style={{ marginBottom: '10px', resize: 'none' }} value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)}></textarea>
              <button className="btn-primary" style={{ backgroundColor: '#9333ea', color: 'white' }} onClick={sendBroadcast}>Push Notification to All</button>
            </div>

            <h3 style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Settings2 size={20} /> Crowd Control Override
            </h3>
            <p className="subtitle" style={{ marginBottom: '16px' }}>Manually adjust crowd limits or let GPS Locator run.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {zones.map(z => (
                <div key={z.id} className="glass-panel" style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontWeight: 500 }}>{z.name}</span>
                    <span className="subtitle" style={{ fontSize: '0.8rem' }}>GPS: {z.activeDevices} devices</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Wait (min)</label>
                      <input type="number" className="form-input" style={{ padding: '6px' }}
                        value={zoneUpdates[z.id]?.waitTime !== undefined ? zoneUpdates[z.id].waitTime : z.waitTime}
                        onChange={e => handleZoneChange(z.id, 'waitTime', Number(e.target.value))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Status</label>
                      <select className="form-input" style={{ padding: '6px', background: 'var(--bg-dark)' }}
                        value={zoneUpdates[z.id]?.congestionLevel || z.congestionLevel}
                        onChange={e => handleZoneChange(z.id, 'congestionLevel', e.target.value)} >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    <button className="btn-primary" style={{ width: 'auto', padding: '6px 12px', margin: 0, height: '34px', fontSize: '0.8rem' }} onClick={() => updateZone(z.id)}>Lock</button>
                  </div>
                </div>
              ))}
            </div>


            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="glass-panel">
                <p className="subtitle">Total Revenue</p>
                <h2>₹{adminData?.totalRevenue || 0}</h2>
              </div>
              <div className="glass-panel">
                <p className="subtitle">Tickets Sold</p>
                <h2>{adminData?.totalTicketsSold || 0}</h2>
              </div>
            </div>
            <h3 style={{ marginTop: '24px', marginBottom: '12px' }}>Global Rate Management</h3>
            <div className="glass-panel" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ whiteSpace: 'nowrap' }}>Current Price: <b>₹{seatPrice}</b></span>
              <input className="form-input" style={{ flex: 1, padding: '8px' }} placeholder="New ₹ Rate" type="number" value={adminPriceInput} onChange={e => setAdminPriceInput(e.target.value)} />
              <button className="btn-primary" style={{ margin: 0, width: 'auto', padding: '8px 16px' }} onClick={changeGlobalPrice}>Apply</button>
            </div>

            <h3 style={{ marginTop: '24px', marginBottom: '12px' }}>Encrypted Viewers Log</h3>
            <div className="zone-grid">
              {!adminData?.seatMappings?.length ? <p className="subtitle">No spectators yet.</p> :
                adminData.seatMappings.map(s => (
                  <div key={s.seat} className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <p><b>Seat {s.seat}</b></p>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{s.contact}</p>
                    </div>
                    <span style={{ textAlign: 'right' }}>{s.name}</span>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </main>

      <nav className="bottom-nav" role="navigation" aria-label="Main Navigation">
        <div className={`nav-item ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')} role="button" tabIndex="0" aria-label="Stadium Map">
          <Map size={24} aria-hidden="true" /><span>Map</span>
        </div>
        {userRole === 'ADMIN' ? (
          <div className={`nav-item ${activeTab === 'admin' ? 'active' : ''}`} onClick={() => setActiveTab('admin')} role="button" tabIndex="0" aria-label="Admin Dashboard">
            <ShieldAlert size={24} aria-hidden="true" /><span>Admin</span>
          </div>
        ) : (
          <div className={`nav-item ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => setActiveTab('alerts')} role="button" tabIndex="0" aria-label="Live Alerts">
            <Bell size={24} aria-hidden="true" /><span>Alerts</span>
          </div>
        )}
        <div className={`nav-item ${activeTab === 'inbox' ? 'active' : ''}`} onClick={() => setActiveTab('inbox')} role="button" tabIndex="0" aria-label="Inbox">
          <div style={{ position: 'relative' }}>
            <MessageSquareWarning size={24} aria-hidden="true" />
            {broadcasts.length > 0 && <div style={{ position: 'absolute', top: '-4px', right: '-4px', width: '8px', height: '8px', background: 'red', borderRadius: '50%' }} aria-label="New message notification" />}
          </div>
          <span>Inbox</span>
        </div>
        <div className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')} role="button" tabIndex="0" aria-label="My Profile">
          <User size={24} aria-hidden="true" /><span>Profile</span>
        </div>
      </nav>
    </>
  );
}

export default App;
