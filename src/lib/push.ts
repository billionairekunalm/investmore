import { sb } from '../store/cloud';

/**
 * Class reminders by Firebase Cloud Messaging (web push).
 * The web config below is public by design (it only identifies the Firebase project). The private service
 * account lives only in the Supabase server function that sends the reminders, never in the app.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyCBw2cV_bf0IK7HZWgXuUbnft4JFasEvag',
  authDomain: 'investmore-754b0.firebaseapp.com',
  projectId: 'investmore-754b0',
  storageBucket: 'investmore-754b0.firebasestorage.app',
  messagingSenderId: '832536186835',
  appId: '1:832536186835:web:36dd20dd912c4bf36da926',
  measurementId: 'G-641WFC6GZ8',
};
/** Web Push certificate (public key) from Firebase Console → Project settings → Cloud Messaging. Public by design. */
const VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) || 'BAda4nMsQUc9Zf6l6L0hQQbJVzdjQc3SqvsPhECvjxa0QCz2P_Urh3UqgnHNTk8ZBJrSn8lQSbamqUggY9zXm9U';

export type PushState = 'unsupported' | 'not-configured' | 'blocked' | 'off' | 'on';

async function messaging() {
  const [{ initializeApp, getApps }, m] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!(await m.isSupported())) return null;
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  return { m, msg: m.getMessaging(app) };
}

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  if (!(await messaging())) return 'unsupported';
  if (!VAPID_KEY) return 'not-configured';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' ? 'on' : 'off';
}

/** Gets this browser's token and saves it for the signed-in student (one row per device / browser). */
async function register(): Promise<void> {
  const f = await messaging();
  if (!f || !VAPID_KEY) throw new Error('Notifications are not available in this browser.');
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase-cloud-messaging-push-scope' });
  const token = await f.m.getToken(f.msg, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not turn on notifications. Please try again.');
  const { error } = await sb!.rpc('save_push_token', { p_token: token, p_user_agent: navigator.userAgent });
  if (error) throw new Error(error.message);
}

/** Student pressed "Turn on reminders": ask permission (only now), then register this device. */
export async function enablePush(): Promise<void> {
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error(p === 'denied' ? 'Notifications are blocked. Allow them in your browser settings for this site.' : 'Notifications were not allowed.');
  await register();
}

/** Already allowed earlier: refresh the token quietly (tokens change over time). */
export async function refreshPush() { if ((await pushState()) === 'on') await register().catch(() => undefined); }

/**
 * While the site is open, Firebase hands the reminder to the page instead of showing it, so we show it ourselves
 * as a normal phone / desktop notification (same look as when the site is closed). Returns an unsubscribe function.
 */
export async function onForegroundPush() {
  const f = await messaging();
  if (!f) return () => undefined;
  return f.m.onMessage(f.msg, async (p) => {
    const reg = (await navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope')) ?? (await navigator.serviceWorker.ready);
    const link = (p.fcmOptions?.link ?? p.data?.link) as string | undefined;
    await reg.showNotification(p.notification?.title ?? 'Class reminder', {
      body: p.notification?.body ?? '', icon: '/icon-512.png', badge: '/icon-192.png',
      tag: p.messageId, data: { link: link ?? '/' },
    });
  });
}

export async function sendTestReminder() {
  const { error } = await sb!.rpc('send_test_reminder');
  if (error) throw new Error(error.message);
}
