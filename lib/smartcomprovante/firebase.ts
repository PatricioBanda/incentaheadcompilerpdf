import type { App } from 'firebase-admin/app'

// Lazy-init singleton — safe in Next.js serverless (each cold-start initialises once).
let app: App | null = null

export const isFirebaseConfigured = Boolean(process.env.FIREBASE_PROJECT_ID)

export const getFirebaseApp = (): App => {
  if (app) return app
  // Dynamic require keeps firebase-admin out of the browser bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initializeApp, getApps, cert } = require('firebase-admin/app') as typeof import('firebase-admin/app')
  if (getApps().length) { app = getApps()[0]; return app }
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel stores the private key with literal \n — replace them back.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  })
  return app
}

export const getFirestore = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getFirestore: _getFirestore } = require('firebase-admin/firestore') as typeof import('firebase-admin/firestore')
  return _getFirestore(getFirebaseApp())
}

export const getStorage = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getStorage: _getStorage } = require('firebase-admin/storage') as typeof import('firebase-admin/storage')
  return _getStorage(getFirebaseApp()).bucket()
}

// ── Firestore helpers ──────────────────────────────────────────────────────────

export const firestoreGet = async <T>(collection: string, docId: string): Promise<T | null> => {
  const db = getFirestore()
  const snap = await db.collection(collection).doc(docId).get()
  return snap.exists ? (snap.data() as T) : null
}

export const firestoreSet = async (collection: string, docId: string, data: object): Promise<void> => {
  const db = getFirestore()
  await db.collection(collection).doc(docId).set(data)
}

export const firestoreUpdate = async (collection: string, docId: string, data: object): Promise<void> => {
  const db = getFirestore()
  await db.collection(collection).doc(docId).update(data)
}

export const firestoreDelete = async (collection: string, docId: string): Promise<void> => {
  const db = getFirestore()
  await db.collection(collection).doc(docId).delete()
}

export const firestoreList = async <T>(collection: string): Promise<Array<{ id: string; data: T }>> => {
  const db = getFirestore()
  const snap = await db.collection(collection).get()
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as T }))
}

// ── Storage helpers ────────────────────────────────────────────────────────────

export const storageSave = async (storagePath: string, buffer: Buffer, contentType: string): Promise<void> => {
  const bucket = getStorage()
  const file = bucket.file(storagePath)
  await file.save(buffer, { contentType, resumable: false })
}

export const storageRead = async (storagePath: string): Promise<Buffer> => {
  const bucket = getStorage()
  const [buffer] = await bucket.file(storagePath).download()
  return buffer
}

export const storageExists = async (storagePath: string): Promise<boolean> => {
  const bucket = getStorage()
  const [exists] = await bucket.file(storagePath).exists()
  return exists
}

export const storageDelete = async (storagePath: string): Promise<void> => {
  const bucket = getStorage()
  await bucket.file(storagePath).delete({ ignoreNotFound: true })
}

export const storageDeletePrefix = async (prefix: string): Promise<void> => {
  const bucket = getStorage()
  const [files] = await bucket.getFiles({ prefix })
  await Promise.all(files.map((f) => f.delete()))
}

export const storageSignedUrl = async (storagePath: string, expiresMs = 15 * 60 * 1000): Promise<string> => {
  const bucket = getStorage()
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresMs,
  })
  return url
}
