import admin from 'firebase-admin';

let firestore: FirebaseFirestore.Firestore | undefined;

/**
 * Initializes the Firebase Admin SDK using either Application Default Credentials
 * (recommended on Cloud Run) or explicit service account environment variables.
 */
export function getFirestore(): FirebaseFirestore.Firestore {
  if (firestore) {
    return firestore;
  }

  if (!admin.apps.length) {
    // Try explicit credentials first (for local development)
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

    if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      // Use Application Default Credentials (works on Cloud Run, Cloud Functions, etc.)
      // This will automatically use the service account attached to the Cloud Run service
      admin.initializeApp();
    }
  }

  firestore = admin.firestore();
  firestore.settings({ databaseId: 'gritto-db' });
  return firestore;
}