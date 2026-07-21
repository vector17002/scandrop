import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { generateId } from "./generateId.js";
import logger from "./logger.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import s3Client from "../config/s3.js";

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const environment = process.env.NODE_ENV || "development";


export const getPresignedUrl = async (contentType : string) => {
  const fileID = generateId();
  const fileKey = `${environment}/${fileID}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileKey,
    ContentType: contentType || "application/octet-stream",
  });   

  //@ts-ignore
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  if(url)
   logger.log(`Generated upload presigned URL for fileKey: ${fileKey} with url  ${url}`, "INFO");

  return { url, fileID };
}


export const getDownloadPresignedUrl = async (fileKey : string) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileKey,
  });

  const url = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });
  logger.log(`Generated download presigned URL for fileKey: ${fileKey}`, "INFO");
  return { url };
}