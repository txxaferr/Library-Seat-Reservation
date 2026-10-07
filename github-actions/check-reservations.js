const admin = require("firebase-admin");

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const messaging = admin.messaging();

const REMINDER_MIN = 10;
const REMINDER_MAX = 15;

async function checkReservation(doc) {
  const data = doc.data();

  // Already reminded or invalid reservation
  if (!data.uid || !data.endAt || data.endReminderSentAt) {
    return;
  }

  const endAt = data.endAt.toDate
    ? data.endAt.toDate()
    : new Date(data.endAt);

  const remainingMinutes =
    (endAt.getTime() - Date.now()) / 60000;

  // Only send when approximately 10–15 minutes remain
  if (
    remainingMinutes < REMINDER_MIN ||
    remainingMinutes > REMINDER_MAX
  ) {
    return;
  }

  // Get user's FCM tokens
  const tokenSnap = await db
    .collection("users")
    .doc(data.uid)
    .collection("fcmTokens")
    .get();

  const tokenDocs = tokenSnap.docs.filter(
    (d) => d.data().token
  );

  const tokens = tokenDocs.map(
    (d) => d.data().token
  );

  if (!tokens.length) {
    console.log(
      `No FCM token found for user ${data.uid}`
    );
    return;
  }

  const seat = String(data.seat ?? "your seat");

  const response =
    await messaging.sendEachForMulticast({
      tokens,

      notification: {
        title: "Library Seat Reservation",
        body: `Your reservation for seat ${seat} ends in about 15 minutes.`,
      },

      data: {
        type: "reservation-ending",
        reservationId: doc.id,
        seat,
      },
    });

  console.log(
    `${doc.id}: ${response.successCount} sent, ${response.failureCount} failed`
  );

  // Prevent duplicate reminders
  if (response.successCount > 0) {
    await doc.ref.update({
      endReminderSentAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // Remove invalid tokens
  await Promise.all(
    response.responses.map(
      async (result, index) => {
        const code = result.error?.code;

        if (
          code ===
            "messaging/registration-token-not-registered" ||
          code ===
            "messaging/invalid-registration-token"
        ) {
          await tokenDocs[index].ref.delete();
        }
      }
    )
  );
}

async function main() {
  for (const status of [
    "Reserved",
    "Checked-in",
  ]) {
    const snapshot = await db
      .collection("reservations")
      .where("status", "==", status)
      .get();

    for (const doc of snapshot.docs) {
      await checkReservation(doc);
    }
  }

  console.log(
    "Reservation reminder check completed."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
