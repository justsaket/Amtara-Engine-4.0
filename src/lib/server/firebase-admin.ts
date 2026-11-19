import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';

export interface FirebaseAdminServices {
  app: App | null;
  auth: Auth | null;
  db: Firestore | null;
  storage: Storage | null;
  projectId: string | null;
  databaseId: string;
  hasExplicitServiceAccount: boolean;
  initError: string | null;
}

let cachedServices: FirebaseAdminServices | null = null;

export function parseServiceAccountFromEnv(): ServiceAccount | null {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawJson) as ServiceAccount & {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      const projectId = parsed.projectId || parsed.project_id;
      const clientEmail = parsed.clientEmail || parsed.client_email;
      const privateKey = (parsed.privateKey || parsed.private_key || '').replace(/\\n/g, '\n');
      if (projectId && clientEmail && privateKey) {
        return { projectId, clientEmail, privateKey };
      }
    } catch {
      // Malformed JSON is reported safely in initError rather than crashing boot
    }
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

export function getFirebaseAdmin(): FirebaseAdminServices {
  if (cachedServices) return cachedServices;

  const { snapshot, firebaseClientConfig } = resolveAutonomousConfiguration();
  const serviceAccount = parseServiceAccountFromEnv();
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    serviceAccount?.projectId ||
    snapshot.firebase.projectId ||
    null;
  const databaseId = snapshot.firebase.databaseId;
  const storageBucket = firebaseClientConfig?.storageBucket;
  const hasExplicitServiceAccount = Boolean(serviceAccount);

  if (!projectId) {
    cachedServices = {
      app: null,
      auth: null,
      db: null,
      storage: null,
      projectId: null,
      databaseId,
      hasExplicitServiceAccount: false,
      initError:
        'Firebase Project ID is not configured yet. Public routes render cleanly; configure Firebase to enable live Auth and Firestore.',
    };
    return cachedServices;
  }

  try {
    let app: App;
    if (getApps().length > 0) {
      app = getApps()[0]!;
    } else if (serviceAccount) {
      app = initializeApp({
        credential: cert(serviceAccount),
        projectId,
        ...(storageBucket ? { storageBucket } : {}),
      });
    } else {
      app = initializeApp({
        projectId,
        ...(storageBucket ? { storageBucket } : {}),
      });
    }

    const auth = getAuth(app);
    const db =
      databaseId && databaseId !== '(default)'
        ? getFirestore(app, databaseId)
        : getFirestore(app);
    const storage = getStorage(app);

    cachedServices = {
      app,
      auth,
      db,
      storage,
      projectId,
      databaseId,
      hasExplicitServiceAccount,
      initError: null,
    };
    return cachedServices;
  } catch (err) {
    cachedServices = {
      app: null,
      auth: null,
      db: null,
      storage: null,
      projectId,
      databaseId,
      hasExplicitServiceAccount,
      initError: err instanceof Error ? err.message : String(err),
    };
    return cachedServices;
  }
}

export function resetFirebaseAdminCacheForTest(): void {
  cachedServices = null;
}
