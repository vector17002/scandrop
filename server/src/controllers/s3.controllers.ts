import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import logger from "../utils/logger.js";
import { multiPartUpload, uploadSingleFile } from "../services/s3.service.js";
import s3Client from "../config/s3.js";
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getDownloadPresignedUrl } from "../utils/getPresignedUrl.js";

export const uploadFileToS3 = async (req : Request, res: Response) => {
    const {contentType , fileName , fileSize} = req.body

    if(!contentType || !fileName || !fileSize){
        logger.log("File not found" , "ERROR")
        return res.status(400).json({ message: "File not found"})
    }

    //@ts-ignore
    const { url, fileToken } = await uploadSingleFile(contentType)

    return res.status(200).json({ url , fileToken });
}

export const startMultiPartUpload = async (req: Request , res: Response) => {
    const { contentType , fileName , fileSize} = req.body

     if(!contentType || !fileName || !fileSize){
        logger.log("File not found" , "ERROR")
        return res.status(400).json({ message: "File not found"})
    }

    const partCount = Math.ceil(fileSize / (10 * 1024 * 1024))
    const result = await multiPartUpload(contentType, partCount)

    const fileToken = jwt.sign({ fileKey: result?.key }, process.env.JWT_SECRET as string, {
        expiresIn: "24h",
        issuer: "snap-drop"
    })

    return res.status(200).json({ ...result, fileToken })
}

export const downloadFileFromS3 = async (req : Request, res: Response) => {
    const token = req.query.token as string

    if(!token){
        logger.log("No token found in the QR", "ERROR")
        return res.status(400).json("No token found")
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET as string, {
            issuer: "snap-drop"
        })
    } catch (error) {
        logger.log("Invalid or expired token", "ERROR")
        return res.status(401).json({ error: "Invalid or expired token" })
    }

    const downloadInfo = await getDownloadPresignedUrl(token)

    if(!downloadInfo?.url){
        logger.log("No file found", "INFO")
        return res.status(404).json({ error: "No file found" });
    }

    return res.status(200).json({ downloadUrl: downloadInfo.url })
}

export const completeMultiPartUpload = async ( req: Request , res: Response) => {
    const { key , uploadId , parts} = req.body

    // @ts-ignore
    const result = await s3Client.send(
        new CompleteMultipartUploadCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
                Parts: parts.sort((a : {PartNumber: number , ETag : string}, b: {PartNumber: number , ETag : string}) => a.PartNumber - b.PartNumber)
            }
        })
    )

    if(!result)
        return res.status(400).json({ error : "There was an issue with completing the upload"})

    return res.status(200).json({ message: "File successfully uploaded."})
}