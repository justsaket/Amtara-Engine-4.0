'use client';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import appletConfigJson from '@root/firebase-applet-config.json';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  firestoreDatabaseId?: string;
}

const rawApplet = appletConfigJson as Partial<FirebaseClientConfig>;

const rawDatabaseId = (
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
  rawApplet.firestoreDatabaseId ||
  ''
).trim();

export const firebaseConfig: FirebaseClientConfig = {
  apiKey: (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || rawApplet.apiKey || '').trim(),
  authDomain: (
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    rawApplet.authDomain ||
    ''
  ).trim(),
  projectId: (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    rawApplet.projectId ||
    ''
  ).trim(),
  storageBucket: (
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    rawApplet.storageBucket ||
    ''
  ).trim(),
  messagingSenderId: (
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    rawApplet.messagingSenderId ||
    ''
  ).trim(),
  appId: (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || rawApplet.appId || '').trim(),
  firestoreDatabaseId: rawDatabaseId || '(default)',
};

export const isFirebaseClientConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    !firebaseConfig.apiKey.startsWith('MY_'),
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let firebaseInitError: string | null = null;

if (isFirebaseClientConfigured) {
  try {
    app = getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db =
      rawDatabaseId && rawDatabaseId !== '(default)'
        ? getFirestore(app, rawDatabaseId)
        : getFirestore(app);
    storage = getStorage(app);
  } catch (err) {
    firebaseInitError =
      err instanceof Error ? err.message : 'Unable to initialize Firebase Client SDK.';
    app = null;
    auth = null;
    db = null;
    storage = null;
  }
} else {
  firebaseInitError =
    'Firebase client credentials are not configured yet. Supply NEXT_PUBLIC_FIREBASE_* or firebase-applet-config.json.';
}

export { app, auth, db, storage, firebaseInitError };

// Identity-only Google sign-in provider for Antara Engine authentication.
// Never requests Workspace, Drive, YouTube, or Apps Script scopes during login.
export const googleSignInProvider = new GoogleAuthProvider();
googleSignInProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo: Array<{ providerId?: string | null; email?: string | null }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline notice: check Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined' && db) {
  void testConnection();
}
