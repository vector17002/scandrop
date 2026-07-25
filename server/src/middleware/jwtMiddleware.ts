import type { NextFunction , Request, Response} from "express";
import jwt from "jsonwebtoken";
import logger from "../utils/logger.js";

const jwtMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const token = req.query.token as string;
        if(!token){
            logger.log("No token found", "ERROR");
            return res.status(400).json("No token found!")
        }

        const isVerified = jwt.verify(token, process.env.JWT_SECRET as string, {
            issuer: "snap-drop"
        })

        if(!isVerified){
            logger.log(`Fail to find file`, "ERROR");
            return res.status(400).json("No file found");
        }

    next();
}

export default jwtMiddleware;