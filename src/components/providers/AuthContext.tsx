'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { apiRequest } from '@/lib/api-client';
import {
  auth,
  firebaseInitError,
  googleSignInProvider,
  isFirebaseClientConfigured,
} from '@/lib/firebase/client';
import type { UserProfile } from '@/types/domain';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isFirebaseReady: boolean;
  firebaseError: string | null;
  authError: string | null;
  clearAuthError: () => void;
  signInWithEmail: (email: string, password: string) => Promise<UserProfile>;
  registerWithEmail: (
    displayName: string,
    email: string,
    password: string,
  ) => Promise<UserProfile>;
  signInWithGoogleIdentity: () => Promise<UserProfile>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<UserProfile | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(isFirebaseClientConfigured);
  const [authError, setAuthError] = useState<string | null>(null);
  const inFlightSyncRef = useRef<{ uid: string; promise: Promise<UserProfile> } | null>(null);

  const syncServerSession = useCallback(async (user: User): Promise<UserProfile> => {
    const existing = inFlightSyncRef.current;
    if (existing && existing.uid === user.uid) {
      return existing.promise;
    }

    const promise = (async () => {
      const idToken = await user.getIdToken();
      const res = await apiRequest<{ user: UserProfile }>('/api/auth/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ idToken }),
      });
      setProfile(res.user);
      setAuthError(null);
      return res.user;
    })();

    inFlightSyncRef.current = { uid: user.uid, promise };
    try {
      return await promise;
    } finally {
      if (inFlightSyncRef.current?.promise === promise) {
        inFlightSyncRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseClientConfigured || !auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        await syncServerSession(user);
      } catch (err) {
        setAuthError(
          err instanceof Error ? err.message : 'Unable to establish authenticated session.',
        );
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [syncServerSession]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<UserProfile> => {
      if (!auth) {
        throw new Error(
          firebaseInitError || 'Firebase Authentication is not configured in this environment.',
        );
      }
      setAuthError(null);
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      return syncServerSession(cred.user);
    },
    [syncServerSession],
  );

  const registerWithEmail = useCallback(
    async (
      displayName: string,
      email: string,
      password: string,
    ): Promise<UserProfile> => {
      if (!auth) {
        throw new Error(
          firebaseInitError || 'Firebase Authentication is not configured in this environment.',
        );
      }
      setAuthError(null);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: displayName.trim() });
      return syncServerSession(cred.user);
    },
    [syncServerSession],
  );

  const signInWithGoogleIdentity = useCallback(async (): Promise<UserProfile> => {
    if (!auth) {
      throw new Error(
        firebaseInitError || 'Firebase Authentication is not configured in this environment.',
      );
    }
    setAuthError(null);
    const cred = await signInWithPopup(auth, googleSignInProvider);
    return syncServerSession(cred.user);
  }, [syncServerSession]);

  const sendPasswordReset = useCallback(async (email: string): Promise<void> => {
    if (!auth) {
      throw new Error(
        firebaseInitError || 'Firebase Authentication is not configured in this environment.',
      );
    }
    setAuthError(null);
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/auth/session', { method: 'DELETE', credentials: 'include' });
    } catch {
      // Proceed with Firebase client sign-out even if server call fails
    }
    if (auth) {
      await firebaseSignOut(auth);
    }
    setProfile(null);
    setFirebaseUser(null);
  }, []);

  const refreshProfile = useCallback(async (): Promise<UserProfile | null> => {
    if (!auth?.currentUser) return null;
    return syncServerSession(auth.currentUser);
  }, [syncServerSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      firebaseUser,
      profile,
      loading,
      isFirebaseReady: isFirebaseClientConfigured && Boolean(auth),
      firebaseError: firebaseInitError,
      authError,
      clearAuthError: () => setAuthError(null),
      signInWithEmail,
      registerWithEmail,
      signInWithGoogleIdentity,
      sendPasswordReset,
      signOut,
      refreshProfile,
    }),
    [
      firebaseUser,
      profile,
      loading,
      authError,
      signInWithEmail,
      registerWithEmail,
      signInWithGoogleIdentity,
      sendPasswordReset,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
