import express from "express";
import cors from "cors";
import uploadRouter from './router/upload.router.js';

const app = express();

app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.use('/api/v1/upload', uploadRouter);


export default app;