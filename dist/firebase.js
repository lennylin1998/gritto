"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirestore = getFirestore;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
let firestore;
/**
 * Initializes the Firebase Admin SDK using either Application Default Credentials
 * (recommended on Cloud Run) or explicit service account environment variables.
 */
function getFirestore() {
    if (firestore) {
        return firestore;
    }
    if (!firebase_admin_1.default.apps.length) {
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT) {
            firebase_admin_1.default.initializeApp();
        }
        else {
            const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
            if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
                firebase_admin_1.default.initializeApp({
                    credential: firebase_admin_1.default.credential.cert({
                        projectId: FIREBASE_PROJECT_ID,
                        clientEmail: FIREBASE_CLIENT_EMAIL,
                        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    }),
                });
            }
            else {
                throw new Error('Firebase credentials not found. Provide GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_* env vars.');
            }
        }
    }
    firestore = firebase_admin_1.default.firestore();
    return firestore;
}
