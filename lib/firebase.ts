import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';

export type PlayerProfile = { name: string; level: string; position: string; goals: string[]; equipment: string[]; duration: number; weakness: string };
export type SavedWorkout = { id: string; completedAt?: string | null; makes: number; attempts: number; percentage: number | null; duration: number; focus: string };
export type AccountUser = { uid: string; name: string; email: string; photoURL: string | null; isGuest: boolean };

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyD2qg4MNLpQrBnnJi4D2WUfVeNo_m3cqY8',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'jc-works-website.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'jc-works-website',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'jc-works-website.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '1051118750435',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:1051118750435:web:74ba9c6d5d7d9730ae53d6',
};

export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
const app = firebaseReady ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
const auth = app ? getAuth(app) : null;

function accountFrom(user: User): AccountUser {
  return {
    uid: user.uid,
    name: user.displayName || (user.isAnonymous ? 'Guest player' : 'Player'),
    email: user.email || '',
    photoURL: user.photoURL,
    isGuest: user.isAnonymous,
  };
}

export function watchAccount(callback: (user: AccountUser | null) => void) {
  if (!auth) { callback(null); return () => undefined; }
  return onAuthStateChanged(auth, (user) => callback(user ? accountFrom(user) : null));
}

export async function continueWithGoogle() {
  if (!auth) throw new Error('Firebase is not configured yet.');
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithRedirect(auth, provider);
  return null;
}

export async function continueAsGuest() {
  if (!auth) throw new Error('Firebase is not configured yet.');
  await setPersistence(auth, browserLocalPersistence);
  const result = await signInAnonymously(auth);
  return accountFrom(result.user);
}

export async function signOutAccount() {
  if (auth) await signOut(auth);
}

async function firebaseUser(): Promise<User> {
  if (!auth) throw new Error('Firebase is not configured yet.');
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  await setPersistence(auth, browserLocalPersistence);
  return (await signInAnonymously(auth)).user;
}

function stringValue(value: string) { return { stringValue: value }; }
function integerValue(value: number) { return { integerValue: String(value) }; }
function profileFields(profile: PlayerProfile, uid: string) {
  return {
    name: stringValue(profile.name), level: stringValue(profile.level), position: stringValue(profile.position),
    goals: { arrayValue: { values: profile.goals.map(stringValue) } },
    equipment: { arrayValue: { values: profile.equipment.map(stringValue) } },
    duration: integerValue(profile.duration), weakness: stringValue(profile.weakness),
    userId: stringValue(uid), updatedAt: { timestampValue: new Date().toISOString() },
  };
}

async function authorization(user: User) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` };
}

export async function savePlayerProfile(profile: PlayerProfile) {
  const user = await firebaseUser();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/players/${user.uid}`, {
    method: 'PATCH', headers: await authorization(user), body: JSON.stringify({ fields: profileFields(profile, user.uid) }),
  });
  if (!response.ok) throw new Error('Player profile could not be saved.');
  return user;
}

export async function saveWorkout(profile: PlayerProfile, workout: Omit<SavedWorkout, 'id' | 'completedAt'> & { drillResults: Record<number, { makes: number; attempts: number }> }) {
  const user = await savePlayerProfile(profile);
  const drillFields = Object.entries(workout.drillResults).map(([index, result]) => ({
    mapValue: { fields: { drill: integerValue(Number(index) + 1), makes: integerValue(result.makes), attempts: integerValue(result.attempts) } },
  }));
  const fields = {
    makes: integerValue(workout.makes), attempts: integerValue(workout.attempts), duration: integerValue(workout.duration),
    percentage: workout.percentage === null ? { nullValue: null } : integerValue(workout.percentage),
    focus: stringValue(workout.focus), completedAt: { timestampValue: new Date().toISOString() },
    drillResults: { arrayValue: { values: drillFields } },
  };
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/players/${user.uid}/workouts`, {
    method: 'POST', headers: await authorization(user), body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error('Workout could not be saved.');
}

const numberFrom = (field: { integerValue?: string; nullValue?: null } | undefined) => field?.integerValue ? Number(field.integerValue) : null;

export async function loadWorkoutHistory(): Promise<SavedWorkout[]> {
  const user = await firebaseUser();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/players/${user.uid}/workouts?pageSize=20&orderBy=completedAt%20desc`, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (!response.ok) throw new Error('Workout history could not be loaded.');
  const data = await response.json() as {
    documents?: Array<{
      name: string;
      fields: Record<string, {
        integerValue?: string;
        stringValue?: string;
        timestampValue?: string;
        nullValue?: null;
      }>;
    }>;
  };
  return (data.documents || []).map((document: { name: string; fields: Record<string, { integerValue?: string; stringValue?: string; timestampValue?: string; nullValue?: null }> }) => ({
    id: document.name.split('/').pop() || document.name,
    completedAt: document.fields.completedAt?.timestampValue || null,
    makes: numberFrom(document.fields.makes) || 0,
    attempts: numberFrom(document.fields.attempts) || 0,
    percentage: numberFrom(document.fields.percentage),
    duration: numberFrom(document.fields.duration) || 0,
    focus: document.fields.focus?.stringValue || '',
  }));
}
