const admin = require("firebase-admin");

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
console.log("[Firebase] Project ID:", serviceAccount.project_id);
const messaging = admin.messaging();

const REMINDER_MIN = 10;
const REMINDER_MAX = 15;

async function getUserTokens(uid) {
  console.log("[FCM] Looking for UID:", uid);

  const snapshot = await db
    .collection("users")
    .doc(uid)
    .collection("fcmTokens")
    .get();

  console.log("[FCM] Documents found:", snapshot.size);

  const validTokens = snapshot.docs
    .filter((doc) => doc.data().token);

  console.log("[FCM] Documents with token:", validTokens.length);

  return validTokens.map((doc) => ({
    ref: doc.ref,
    token: doc.data().token,
  }));
}

async function sendNotification(tokens, title, body, data) {
  if (!tokens.length) {
    console.log(`[FCM] No tokens found for: ${title}`);
    return false;
  }

  console.log(`[FCM] Attempting to send: ${title}`);
  console.log(`[FCM] Token count: ${tokens.length}`);

  const response = await messaging.sendEachForMulticast({
    tokens: tokens.map((item) => item.token),
    notification: { title, body },
    data,
  });

  console.log(`[FCM] Success: ${response.successCount}`);
  console.log(`[FCM] Failure: ${response.failureCount}`);

  const cleanup = [];

  response.responses.forEach((result, index) => {
    if (result.success) {
      console.log(`[FCM] Token ${index + 1}: SENT`);
      return;
    }

    const code = result.error?.code;
    const message = result.error?.message;

    console.error(
      `[FCM] Token ${index + 1}: FAILED`,
      code,
      message
    );

    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      cleanup.push(tokens[index].ref.delete());
      console.log(`[FCM] Invalid token ${index + 1} scheduled for deletion`);
    }
  });

  await Promise.all(cleanup);

  return response.successCount > 0;
}

async function checkReservation(doc) {
  const data = doc.data();

  if (!data.uid || !data.endAt) return;

  const endAt = data.endAt.toDate
    ? data.endAt.toDate()
    : new Date(data.endAt);

  const now = Date.now();
  const remainingMinutes = (endAt.getTime() - now) / 60000;

  const tokens = await getUserTokens(data.uid);
  const seat = String(data.seat ?? "your seat");

  // 1. แจ้งเตือนก่อนหมดเวลา 10–15 นาที
  if (
    remainingMinutes >= REMINDER_MIN &&
    remainingMinutes <= REMINDER_MAX &&
    !data.endReminderSentAt
  ) {
    const sent = await sendNotification(
      tokens,
      "Library Seat Reservation",
      `Your reservation for seat ${seat} ends in about 15 minutes.`,
      {
        type: "reservation-ending",
        reservationId: doc.id,
        seat,
      }
    );

    if (sent) {
      await doc.ref.update({
        endReminderSentAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // 2. หมดเวลาแล้ว: เปลี่ยนสถานะและแจ้งเตือน
  if (endAt.getTime() <= now) {
    if (data.status !== "Expired") {
      await doc.ref.update({ status: "Expired" });
    }

    if (!data.expiredNotificationSentAt) {
      const sent = await sendNotification(
        tokens,
        "Reservation Expired",
        `Your reservation for seat ${seat} has expired.`,
        {
          type: "reservation-expired",
          reservationId: doc.id,
          seat,
        }
      );

      if (sent) {
        await doc.ref.update({
          expiredNotificationSentAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }
}

async function main() {
  for (const status of [
    "Reserved",
    "Checked-in",
    "Expired",
  ]) {
    const snapshot = await db
      .collection("reservations")
      .where("status", "==", status)
      .get();

    for (const doc of snapshot.docs) {
      try {
        await checkReservation(doc);
      } catch (error) {
        console.error(`Reservation ${doc.id}:`, error);
      }
    }
  }

  console.log("Reservation notification check completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
