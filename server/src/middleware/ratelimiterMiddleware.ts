import type {Request, Response, NextFunction } from "express";
import RateLimiter from "../models/ratelimiter.js";
import logger from "../utils/logger.js";

const rateLimiterMiddleware = (req: Request, res: Response, next: NextFunction) => {

    // Allowing 5 requests per minute per IP address
    const rateLimiter = RateLimiter.getInstance(5, 60 * 1000); 

    const ip = req.ip;

    if(!ip){
        logger.log('IP address not found.', 'ERROR', new Date());
        return res.status(400).send('IP address not found.');
    }

    logger.log(`IP: ${ip}, Requests: ${rateLimiter.requests.get(ip)?.count || 0} with last timestamp: ${rateLimiter.requests.get(ip)?.timestamp || 0}`, "INFO", new Date());
    
    if (!rateLimiter.isAllowed(ip)) {
        logger.log(`IP: ${ip} has exceeded the rate limit.`, "ERROR", new Date());
        return res.status(429).send('Too many requests. Please try again later.');
    }

    next();
}

export default rateLimiterMiddleware;