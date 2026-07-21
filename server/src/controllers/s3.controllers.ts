import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import logger from "../utils/logger.js";
import { upload } from "../services/s3.service.js";

export const uploadFileToS3 = async (req : Request, res: Response) => {
    const body = req.body;
    const contentType = body.contentType;

    //@ts-ignore
    const { url , fileID } = await upload(contentType)

    return res.status(200).json({ url , fileID });
}

export const startMultiPartUpload = async (req: Request , res: Response) => {
    return res.status(200).json({ message : "Multi part upload route is working"})
}

export const downloadFileFromS3 = async (req : Request, res: Response) => {
    const token = req.query.token as string

    if(!token){
        logger.log("No token found in the QR", "ERROR")
        return res.status(400).json("No token found")
    }

    const decryptedFileID = jwt.decode(token, {
        complete: true
    })

    if(!decryptedFileID){
        logger.log("No file found", "INFO")
        return res.status(402).json("No file found");
    }

    return res.status(200).json({ message: "Download route is working!" });
}