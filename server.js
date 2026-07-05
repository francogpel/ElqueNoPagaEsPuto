// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  DIVIDIR GASTOS — Servidor principal v3.0                               ║
// ║  No modificar este archivo directamente.                                ║
// ║  Toda la configuración va en el archivo .env (ver .env.example)         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const fs       = require("fs");
const path     = require("path");
const fetch    = require("node-fetch");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const store = require("./services/firestore");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Variables de entorno ─────────────────────────────────────────────────────
// Todas vienen del archivo .env que vas a crear copiando .env.example
const PORT       = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// ═══════════════════════════════════════════════════════════════════════════════
// BLOQUE 1: FIREBASE ADMIN
// Usamos Firebase para verificar que solo los admins autenticados puedan
// crear salas y marcar pagos.
// Configurá FIREBASE_SERVICE_ACCOUNT_JSON en tu .env
// ═══════════════════════════════════════════════════════════════════════════════
try {
  // 🔧 FIREBASE_SERVICE_ACCOUNT_JSON: JSON de cuenta de servicio en base64
  // Lo generás en: Firebase Console → Configuración → Cuentas de servicio
  const raw          = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "", "base64").toString();
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const firestore = getFirestore();

console.log("✅ Firebase Admin inicializado");
console.log("✅ Firestore conectado");
} catch {
  // En desarrollo local sin Firebase, el servidor igual arranca pero sin auth
  console.warn("⚠️  Firebase Admin no configurado — rutas de admin sin protección (solo para desarrollo)");
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOQUE 2: MERCADO PAGO
// MP_ACCESS_TOKEN es el token de TU propia cuenta (para cuando el admin
// no haya conectado la suya todavía). Es el fallback.
// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 MP_ACCESS_TOKEN: Token de producción o prueba de tu cuenta de MP
// Lo encontrás en: mercadopago.com.ar/developers/panel/app → Credenciales
const defaultMpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || ""
});

// ─── DB (archivo JSON — para producción avanzada migrar a Postgres) ───────────
const DB_PATH = path.join(__dirname, "db.json");
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { rooms: {}, mpTokens: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  if (!data.mpTokens) data.mpTokens = {};
  return data;
}
function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
let db = loadDB();
const store = require("./services/firestore");

// ─── Middleware: verificar token de Firebase ──────────────────────────────────
// Todas las rutas de admin pasan por acá para verificar que el usuario
// esté autenticado con Firebase.
async function requireAdmin(req, res, next) {
  if (!admin.apps.length) return next(); // modo desarrollo sin Firebase

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autorizado — token faltante" });

  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOQUE 3: RUTAS PÚBLICAS
// ═══════════════════════════════════════════════════════════════════════════════

// Configuración pública de Firebase para el frontend
// 🔧 Requiere: FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID en .env
app.get("/api/config", (req, res) => {
  res.json({
    apiKey:     process.env.FIREBASE_API_KEY     || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId:  process.env.FIREBASE_PROJECT_ID  || "",
  });
});

// Obtener sala (público — los participantes lo usan sin autenticarse)
app.get("/api/rooms/:id", (req, res) => {
  const room = db.rooms[req.params.id];
  if (!room) return res.status(404).json({ error: "Sala no encontrada" });
  // No enviamos el mpAccessToken al cliente por seguridad
  const { mpAccessToken, ...safeRoom } = room;
  res.json(safeRoom);
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOQUE 4: MERCADO PAGO OAUTH
// Permite que el admin conecte SU cuenta de MP a la app para que los pagos
// de los participantes vayan directamente a su cuenta.
//
// 🔧 Requiere en .env:
//    MP_CLIENT_ID     → ID de tu app en MP Developers
//    MP_CLIENT_SECRET → Secret de tu app en MP Developers
//
// Cómo obtenerlos:
//   1. Entrá a mercadopago.com.ar/developers/panel/app
//   2. Creá una aplicación (o abrí la que ya tenés)
//   3. En "Credenciales OAuth", copiá Client ID y Client Secret
//   4. En "URLs de redirección", agregá: {PUBLIC_URL}/api/mp-oauth/callback
// ═══════════════════════════════════════════════════════════════════════════════

// Genera la URL de autorización de Mercado Pago para que el admin conecte su cuenta
app.get("/api/mp-oauth/url", requireAdmin, (req, res) => {
  // 🔑 MP_CLIENT_ID identifica TU aplicación ante Mercado Pago
  const clientId    = process.env.MP_CLIENT_ID || "";
  const redirectUri = encodeURIComponent(`${PUBLIC_URL}/api/mp-oauth/callback`);
  // El 'state' lleva el UID del admin para saber a quién guardar el token después
  const state       = req.user?.uid || "dev";

  if (!clientId) {
    return res.status(500).json({ error: "MP_CLIENT_ID no configurado en .env" });
  }

  const url = `https://auth.mercadopago.com/authorization?` +
    `client_id=${clientId}` +
    `&response_type=code` +
    `&platform_id=mp` +
    `&redirect_uri=${redirectUri}` +
    `&state=${state}`;

  res.json({ url });
});

// Callback de Mercado Pago: MP redirige acá después de que el admin autoriza
// 🔑 MP manda el 'code' que cambiamos por un access_token real
app.get("/api/mp-oauth/callback", async (req, res) => {
  const { code, state: adminUid } = req.query;
  if (!code) return res.redirect(`/?mp_error=no_code`);

  try {
    // Intercambiamos el código por el access_token del admin
    const response = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        // 🔧 MP_CLIENT_ID y MP_CLIENT_SECRET: credenciales de TU app en MP
        client_id:     process.env.MP_CLIENT_ID     || "",
        client_secret: process.env.MP_CLIENT_SECRET || "",
        code,
        grant_type:    "authorization_code",
        redirect_uri:  `${PUBLIC_URL}/api/mp-oauth/callback`,
      }),
    });
    const tokenData = await response.json();
    if (!tokenData.access_token) throw new Error("Token inválido");

    // Obtenemos el perfil del admin en MP para mostrar su nickname/alias
    const userRes  = await fetch(`https://api.mercadopago.com/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();

    // Guardamos el token del admin asociado a su UID de Firebase
    db.mpTokens[adminUid] = {
      accessToken: tokenData.access_token,
      userId:      tokenData.user_id,
      nickname:    userData.nickname || userData.email || "tu cuenta",
      connectedAt: new Date().toISOString(),
    };
    saveDB(db);

    // Redirigimos al frontend con la señal de éxito
    res.redirect(`/?mp_connected=true`);
  } catch (err) {
    console.error("Error en OAuth MP:", err);
    res.redirect(`/?mp_error=oauth_failed`);
  }
});

// Estado de conexión con MP del admin autenticado
app.get("/api/mp-oauth/status", requireAdmin, (req, res) => {
  const uid   = req.user?.uid || "dev";
  const token = db.mpTokens[uid];
  if (token) {
    res.json({ connected: true, nickname: token.nickname });
  } else {
    res.json({ connected: false });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOQUE 5: RUTAS DE ADMIN (requieren autenticación Firebase)
// ═══════════════════════════════════════════════════════════════════════════════

// Listar salas del admin autenticado
app.get("/api/rooms", requireAdmin, (req, res) => {
  const uid   = req.user?.uid || "dev";
  const rooms = Object.values(db.rooms)
    .filter(r => r.adminUid === uid)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(({ mpAccessToken, ...safe }) => safe); // nunca enviamos el token al cliente
  res.json(rooms);
});

// Crear sala
app.post("/api/rooms", requireAdmin, (req, res) => {
  const { title, total, participants } = req.body;
  if (!title || !total || !Array.isArray(participants) || participants.length < 2)
    return res.status(400).json({ error: "Datos incompletos" });

  const uid = req.user?.uid || "dev";
  const id  = makeRoomId();

  // Si el admin conectó su cuenta de MP, usamos SU token para que reciba los pagos
  const mpToken = db.mpTokens[uid]?.accessToken || null;

  const room = {
    id, title, total,
    mpAlias:      db.mpTokens[uid]?.nickname || "",
    mpAccessToken: mpToken, // ← guardado en DB pero nunca enviado al cliente
    adminUid:     uid,
    createdAt:    new Date().toISOString(),
    participants: participants.map((name, i) => ({
      id:        String(i + 1),
      name,
      paid:      false,
      paymentId: null,
      paidAt:    null,
    })),
  };
  await store.createRoom(room);

// Compatibilidad temporal con db.json
db.rooms[id] = room;
saveDB(db);

  const { mpAccessToken: _, ...safeRoom } = room;
  res.json({ ...safeRoom, shareUrl: `${PUBLIC_URL}/?room=${id}` });
});

// Actualizar alias del admin en la sala
app.patch("/api/rooms/:id/alias", requireAdmin, (req, res) => {
  const room = db.rooms[req.params.id];
  if (!room) return res.status(404).json({ error: "Sala no encontrada" });
  room.mpAlias = (req.body.alias || "").trim();
  saveDB(db);
  const { mpAccessToken, ...safe } = room;
  res.json(safe);
});

// Marcar participante como pagado en efectivo (solo admin)
app.post("/api/rooms/:roomId/mark-paid/:participantId", requireAdmin, (req, res) => {
  const room = db.rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: "Sala no encontrada" });
  const p = room.participants.find(x => x.id === req.params.participantId);
  if (!p) return res.status(404).json({ error: "Participante no encontrado" });
  p.paid      = true;
  p.paymentId = "efectivo";
  p.paidAt    = new Date().toISOString();
  saveDB(db);
  const { mpAccessToken, ...safe } = room;
  res.json(safe);
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOQUE 6: PAGO CON MERCADO PAGO (público — lo llama el participante)
// Crea una preferencia de pago y devuelve el link de checkout.
// Si el admin conectó su cuenta, el pago va a SU cuenta directamente.
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/rooms/:roomId/pay/:participantId", async (req, res) => {
  const room = db.rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: "Sala no encontrada" });

  const p = room.participants.find(x => x.id === req.params.participantId);
  if (!p)       return res.status(404).json({ error: "Participante no encontrado" });
  if (p.paid)   return res.status(400).json({ error: "Ya pagó" });

  const amount = Math.round(room.total / room.participants.length);

  // Usamos el token del admin de la sala (su cuenta personal de MP)
  // Si no lo tiene, usamos el token del servidor como fallback
  const tokenToUse = room.mpAccessToken || process.env.MP_ACCESS_TOKEN || "";
  const mpClient   = new MercadoPagoConfig({ accessToken: tokenToUse });

  try {
    const preference = new Preference(mpClient);
    const result     = await preference.create({
      body: {
        items: [{
          title:       `${room.title} — parte de ${p.name}`,
          quantity:    1,
          unit_price:  amount,
          currency_id: "ARS",
        }],
        // La external_reference nos permite saber qué sala y participante pagó
        // cuando llega el webhook de MP
        external_reference: `${room.id}:${p.id}`,
        // 📡 WEBHOOK: MP llama a esta URL cuando se confirma el pago
        // Requiere que PUBLIC_URL sea una URL pública real (no localhost)
        notification_url: `${PUBLIC_URL}/api/webhook`,
        back_urls: {
          success: `${PUBLIC_URL}/?room=${room.id}&pago=ok`,
          failure: `${PUBLIC_URL}/?room=${room.id}&pago=error`,
          pending: `${PUBLIC_URL}/?room=${room.id}&pago=pendiente`,
        },
        auto_return: "approved",
      },
    });
    res.json({ init_point: result.init_point });
  } catch (err) {
    console.error("Error creando preferencia MP:", err);
    res.status(500).json({ error: "No se pudo generar el link de pago" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOQUE 7: WEBHOOK DE MERCADO PAGO
// MP llama este endpoint automáticamente cuando alguien paga.
// No requiere autenticación (MP no manda token, manda el payment ID).
// IMPORTANTE: PUBLIC_URL debe ser una URL pública con HTTPS para que funcione.
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/webhook", async (req, res) => {
  res.sendStatus(200); // responder rápido siempre, MP reintenta si tarda

  try {
    const topic     = req.query.topic || req.query.type || req.body?.type;
    const paymentId = req.query["data.id"] || req.body?.data?.id;
    if (topic !== "payment" || !paymentId) return;

    // Verificamos el pago usando el token del servidor (fallback)
    // El pago ya está confirmado en la cuenta del admin de la sala
    const payment = new Payment(defaultMpClient);
    const info    = await payment.get({ id: paymentId });
    if (info.status !== "approved") return;

    const [roomId, participantId] = (info.external_reference || "").split(":");
    const room = db.rooms[roomId];
    if (!room) return;

    const p = room.participants.find(x => x.id === participantId);
    if (p && !p.paid) {
      p.paid      = true;
      p.paymentId = String(paymentId);
      p.paidAt    = new Date().toISOString();
      saveDB(db);
      console.log(`✅ Pago confirmado: ${room.title} — ${p.name}`);
    }
  } catch (err) {
    console.error("Error en webhook MP:", err);
  }
});

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🌐 URL configurada: ${PUBLIC_URL}`);
  console.log(`\nVariables de entorno cargadas:`);
  console.log(`  Firebase:       ${process.env.FIREBASE_PROJECT_ID ? "✅" : "❌ falta FIREBASE_PROJECT_ID"}`);
  console.log(`  MP Token:       ${process.env.MP_ACCESS_TOKEN     ? "✅" : "❌ falta MP_ACCESS_TOKEN"}`);
  console.log(`  MP OAuth:       ${process.env.MP_CLIENT_ID        ? "✅" : "❌ falta MP_CLIENT_ID (opcional)"}\n`);
});
