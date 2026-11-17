import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import defaultFirebaseConfig from '../firebase-applet-config.json';
import type { FirebaseCustomConfig } from './types/catering';

export const LS_FIREBASE_CONFIG_KEY = 'garuda4_firebase_config';

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
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function loadActiveConfig(): {
  config: FirebaseCustomConfig;
  isCustom: boolean;
} {
  try {
    const raw = localStorage.getItem(LS_FIREBASE_CONFIG_KEY);
    if (raw && raw.trim()) {
      const parsed = JSON.parse(raw) as FirebaseCustomConfig;
      if (parsed && parsed.apiKey && parsed.projectId && parsed.appId) {
        return { config: parsed, isCustom: true };
      }
    }
  } catch {
    // Abaikan jika JSON invalid di localStorage dan gunakan config bawaan
  }
  return {
    config: defaultFirebaseConfig as FirebaseCustomConfig,
    isCustom: false,
  };
}

const { config: activeConfig, isCustom: isCustomFirebaseConfigActive } = loadActiveConfig();

const app: FirebaseApp =
  getApps().length > 0 ? getApps()[0] : initializeApp(activeConfig);

const db: Firestore = activeConfig.firestoreDatabaseId
  ? getFirestore(app, activeConfig.firestoreDatabaseId)
  : getFirestore(app);

const auth: Auth = getAuth(app);
const storage: FirebaseStorage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export {
  app,
  db,
  auth,
  storage,
  googleProvider,
  activeConfig,
  isCustomFirebaseConfigActive,
};

export function getDefaultConfigJson(): string {
  return JSON.stringify(defaultFirebaseConfig, null, 2);
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
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
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
