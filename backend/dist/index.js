"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const morgan_1 = __importDefault(require("morgan"));
const firebase_1 = require("./firebase");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = Number(process.env.PORT) || 8080;
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/firestore/:collection/:docId', async (req, res, next) => {
    try {
        const db = (0, firebase_1.getFirestore)();
        const doc = await db.collection(req.params.collection).doc(req.params.docId).get();
        if (!doc.exists) {
            res.status(404).json({ error: 'Document not found.' });
            return;
        }
        res.json({ id: doc.id, data: doc.data() });
    }
    catch (error) {
        next(error);
    }
});
app.post('/firestore/:collection', async (req, res, next) => {
    try {
        const db = (0, firebase_1.getFirestore)();
        const docRef = await db.collection(req.params.collection).add(req.body);
        res.status(201).json({ id: docRef.id });
    }
    catch (error) {
        next(error);
    }
});
app.use((err, _req, res, _next) => {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', details: message });
});
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
