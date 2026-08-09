
import fs from "fs"
import { CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import s3Client from "../config/s3.js";
import logger from "../utils/logger.js";
import { getPresignedUrl } from "../utils/getPresignedUrl.js";
import { generateId } from "../utils/generateId.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";


const BUCKET = process.env.AWS_S3_BUCKET_NAME
const ENVIRONMENT = process.env.NODE_ENV || "development"

export const updateLogsFile = async (fileKey : string, localFilePath : string) => {
    try{
    // ANSH - IMPLEMENT FUNCTIONALITY TO LOG THE LOGS IN S3.
    const fileContents = fs.readFileSync(localFilePath, "utf-8");

    // @ts-ignore
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: fileKey,
        Body:  fileContents,
        ContentType: "text/plain",
      })
    )
  }catch(err){
    console.error("Error while logging to S3: ", err);
  }
}

export const getLogsFile = async (fileKey : string) => {
  try{ 
    //@ts-ignore
    const data = await s3Client.send(
      new GetObjectCommand({
         Bucket: BUCKET,
        Key: fileKey,
      })
    )
  }catch(err){
    console.error("Error while fetching logs from S3: ", err);
  }
}

export const deleteLogsFile = async (fileKey : string) => {
  try{
    //@ts-ignore
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: fileKey,
      })
    )

    console.log("Successfully deleted logs");
  }catch(err){
    console.error("Error while deleting logs from S3: ", err);
  }
}

export const uploadSingleFile = async (contentType : string, fileName?: string) => {
  try{
     const safeName = fileName ? fileName.replace(/[^a-zA-Z0-9_.-]/g, '_') : ''
     const fileID = safeName ? `${generateId()}-${safeName}` : generateId()
     const data = await getPresignedUrl(fileID, contentType);

     return data
  }catch(err){
     logger.log(`Upload failed for contentType "${contentType}": ${err instanceof Error ? err.message : err}`, "ERROR")
  }
}

export const multiPartUpload = async (contentType : string, partCount : number, fileName?: string) => {
   try{
    const safeName = fileName ? fileName.replace(/[^a-zA-Z0-9_.-]/g, '_') : ''
    const fileID = safeName ? `${generateId()}-${safeName}` : generateId(); 

    //@ts-ignore
    const multiPartUploadCommand = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: BUCKET,
        Key: `${ENVIRONMENT}/${fileID}`,
        ContentType: contentType
      })
    );

    const urls = await Promise.all(
      Array.from({length :  partCount}, async (_ , index) => {
        const partNumber = index + 1
        const individualPartCommand = new UploadPartCommand({
          Bucket: BUCKET,
          Key: `${ENVIRONMENT}/${fileID}`,
          UploadId: multiPartUploadCommand.UploadId,
          PartNumber: partNumber
        })

        return {
          partNumber,
          //@ts-ignore
          url: await getSignedUrl(s3Client, individualPartCommand, { expiresIn: 60 * 60 })
        }
      } )
    )

    return { uploadId: multiPartUploadCommand.UploadId, key: `${ENVIRONMENT}/${fileID}`, urls }
     
   }catch(err){
     logger.log(`Error executing multipart upload`, "ERROR")
   }
}