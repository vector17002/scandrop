import express from "express";
import cors from "cors";
import  { uploadRouter,  downloadRouter, multipartRouter } from './router/awsS3.router.js';
import rateLimiterMiddleware from "./middleware/ratelimiterMiddleware.js";


const app = express();

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ??  ["https://scandrop-ihuc.onrender.com,https://scandrop-8v9p0zpve-geek-sanemi.vercel.app"],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use('/api/v1/upload', rateLimiterMiddleware, uploadRouter);

app.use('/api/v1/download' , rateLimiterMiddleware, downloadRouter)

app.use('/api/v1/multipartupload', rateLimiterMiddleware , multipartRouter)


export default app;