"use strict";

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const PROJECT_ID = "library-seat-reservation-28680";
const SECRET_NAME = "FIREBASE_SERVICE_ACCOUNT";
const seedPath = path.join(__dirname, "tables-seed.json");

function fail(message) {
  console.error(`SEED FAILED: ${message}`);
  process.exit(1);
}

async function main() {
  const rawCredential = process.env[SECRET_NAME];
  if (!rawCredential) {
    fail(`Missing GitHub Secret ${SECRET_NAME}.`);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(rawCredential);
  } catch {
    fail(`${SECRET_NAME} is not valid JSON.`);
  }

  if (serviceAccount.project_id !== PROJECT_ID) {
    fail(`Service Account project_id must be ${PROJECT_ID}; received ${serviceAccount.project_id || "missing"}.`);
  }

  const tables = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  if (!Array.isArray(tables) || tables.length !== 90) {
    fail(`Expected exactly 90 table records; found ${Array.isArray(tables) ? tables.length : "invalid data"}.`);
  }

  const ids = tables.map((item) => item.tableId);
  if (new Set(ids).size !== ids.length) {
    fail("Duplicate tableId values found in seed JSON.");
  }

  const required = ["tableId", "floor", "zoneId", "type", "capacity", "minGroupSize", "isReservable"];
  for (const item of tables) {
    for (const field of required) {
      if (!(field in item)) fail(`Record ${item.tableId || "(unknown)"} is missing ${field}.`);
    }
    if (![1, 2].includes(item.floor)) fail(`Invalid floor on ${item.tableId}.`);
    if (!["group", "individual"].includes(item.type)) fail(`Invalid type on ${item.tableId}.`);
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: PROJECT_ID
  });

  const db = admin.firestore();
  const refs = tables.map((item) => db.collection("tables").doc(item.tableId));
  const existingSnapshots = await db.getAll(...refs);
  const existingIds = existingSnapshots.filter((snap) => snap.exists).map((snap) => snap.id);

  if (existingIds.length > 0) {
    fail(
      `No documents were written. ${existingIds.length} of the requested IDs already exist: ` +
      `${existingIds.slice(0, 10).join(", ")}${existingIds.length > 10 ? ", ..." : ""}. ` +
      "Review existing tables before deciding how to proceed; this script never overwrites."
    );
  }

  const batch = db.batch();
  tables.forEach((item, index) => {
    batch.create(refs[index], {
      ...item,
      schemaVersion: 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  console.log(`SUCCESS: Created ${tables.length} documents in ${PROJECT_ID}/tables.`);
  console.log("Existing documents were not overwritten. Legacy seats/reservations/users were not modified.");
}

main().catch((error) => {
  console.error("SEED FAILED:", error);
  process.exit(1);
});
