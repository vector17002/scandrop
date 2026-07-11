import express from 'express'
import rateLimiterMiddleware from '../middleware/ratelimiterMiddleware.js';

const router = express.Router();

router.get('/', rateLimiterMiddleware, (req, res) => {
    res.send('Upload route is working!');
});

export default router;