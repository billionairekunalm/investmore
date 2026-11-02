// Firebase Cloud Messaging: receives class reminders when the site is in the background or closed.
// The reminder carries a notification + link, so Firebase shows it and opens the link on click.
importScripts('https://www.gstatic.com/firebasejs/13.1.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.1.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCBw2cV_bf0IK7HZWgXuUbnft4JFasEvag',
  authDomain: 'investmore-754b0.firebaseapp.com',
  projectId: 'investmore-754b0',
  storageBucket: 'investmore-754b0.firebasestorage.app',
  messagingSenderId: '832536186835',
  appId: '1:832536186835:web:36dd20dd912c4bf36da926',
});
firebase.messaging();

// Tapping a reminder that the open site showed (see onForegroundPush): open / focus the class page.
// Firebase's own notifications carry FCM_MSG and are opened by Firebase itself.
self.addEventListener('notificationclick', (e) => {
  const link = e.notification.data && !e.notification.data.FCM_MSG ? e.notification.data.link : null;
  if (!link) return;
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const url = new URL(link, self.location.origin).href;
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url); return c.focus(); }
    return clients.openWindow(url);
  }));
});
