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
