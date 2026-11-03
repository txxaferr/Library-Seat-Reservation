
importScripts(
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyCXLBGi3xm-wnjxJQP9NhBNtTMoWF6yT3s",
  authDomain: "library-seat-reservation-28680.firebaseapp.com",
  projectId: "library-seat-reservation-28680",
  storageBucket: "library-seat-reservation-28680.firebasestorage.app",
  messagingSenderId: "393080839732",
  appId: "1:393080839732:web:5787e028d931fc4282f461"
});

const messaging = firebase.messaging();

// Receive notifications when the website is in the background.
messaging.onBackgroundMessage((payload) => {
  console.log("Background message received:", payload);

  const title =
    payload.notification?.title ||
    payload.data?.title ||
    "Library Seat Reservation";

  const options = {
    body:
      payload.notification?.body ||
      payload.data?.body ||
      "You have a library reservation notification.",
    data: payload.data || {}
  };

  self.registration.showNotification(title, options);
});

// Open the reservation website when the notification is tapped.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = "/Library-Seat-Reservation/";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/Library-Seat-Reservation/")) {
          return client.focus();
        }
      }

      return clients.openWindow(url);
    })
  );
});

