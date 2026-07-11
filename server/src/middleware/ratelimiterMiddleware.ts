import type {Request, Response, NextFunction } from "express";
import RateLimiter from "../models/ratelimiter.js";

const rateLimiterMiddleware = (req: Request, res: Response, next: NextFunction) => {

    // Allowing 5 requests per minute per IP address
    const rateLimiter = RateLimiter.getInstance(5, 60 * 1000); 

    const ip = req.ip;

    if(!ip){
        return res.status(400).send('IP address not found.');
    }

    console.log(`IP: ${ip}, Requests: ${rateLimiter.requests.get(ip)?.count || 0} with last timestamp: ${rateLimiter.requests.get(ip)?.timestamp || 0}`);
    
    if (!rateLimiter.isAllowed(ip)) {
        return res.status(429).send('Too many requests. Please try again later.');
    }

    next();
}

export default rateLimiterMiddleware;