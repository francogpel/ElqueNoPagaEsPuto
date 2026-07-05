const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();

const ROOMS = db.collection("rooms");
const MP_TOKENS = db.collection("mpTokens");

// ---------- ROOMS ----------

async function createRoom(room) {
  await ROOMS.doc(room.id).set(room);
  return room;
}

async function getRoom(id) {
  const doc = await ROOMS.doc(id).get();
  if (!doc.exists) return null;
  return doc.data();
}

async function updateRoom(id, data) {
  await ROOMS.doc(id).update(data);
}

async function listRooms(adminUid) {
  const snap = await ROOMS
    .where("adminUid", "==", adminUid)
    .orderBy("createdAt", "desc")
    .get();

  return snap.docs.map(doc => doc.data());
}

// ---------- MP TOKENS ----------

async function saveMpToken(uid, token) {
  await MP_TOKENS.doc(uid).set(token);
}

async function getMpToken(uid) {
  const doc = await MP_TOKENS.doc(uid).get();
  if (!doc.exists) return null;
  return doc.data();
}

module.exports = {
  createRoom,
  getRoom,
  updateRoom,
  listRooms,
  saveMpToken,
  getMpToken,
  FieldValue
};