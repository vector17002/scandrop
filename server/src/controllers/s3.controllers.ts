import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import logger from "../utils/logger.js";
import { multiPartUpload, uploadSingleFile } from "../services/s3.service.js";
import s3Client from "../config/s3.js";
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";

export const uploadFileToS3 = async (req : Request, res: Response) => {
    const {contentType , fileName , fileSize} = req.body

    if(!contentType || !fileName || !fileSize){
        logger.log("File not found" , "ERROR")
        return res.status(400).json({ message: "File not found"})
    }

    //@ts-ignore
    const { url, fileID } = await uploadSingleFile(contentType)

    return res.status(200).json({ url , fileID });
}

export const startMultiPartUpload = async (req: Request , res: Response) => {
    const { contentType , fileName , fileSize} = req.body

     if(!contentType || !fileName || !fileSize){
        logger.log("File not found" , "ERROR")
        return res.status(400).json({ message: "File not found"})
    }

    const partCount = Math.ceil(fileSize / (10 * 1024 * 1024))
    const result = await multiPartUpload(contentType, partCount)

    return res.status(200).json(result)
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
        return res.status(404).json("No file found");
    }

    return res.status(200).json({ message: "Download route is working!" });
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