import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import logger from "./logger.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import s3Client from "../config/s3.js";
import jwt from "jsonwebtoken"

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const environment = process.env.NODE_ENV || "development";


export const getPresignedUrl = async (fileID: string, contentType : string) => {
  const fileKey = `${environment}/${fileID}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileKey,
    ContentType: contentType || "application/octet-stream",
  });   

  //@ts-ignore
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  if(!url)
   logger.log(`Generated upload presigned URL for fileKey: ${fileKey}`, "INFO");

  const fileToken = jwt.sign({fileKey: `${environment}/${fileID}`}, process.env.JWT_SECRET as string, {
    expiresIn: "24h",
    issuer: "snap-drop"
  })

  console.log(fileToken)

  return { url, fileToken };
}


export const getDownloadPresignedUrl = async (token : string) => {
try{
  //@ts-ignore
  const verifiedToken : { fileKey : string} = jwt.verify(token, process.env.JWT_SECRET as string, {
    issuer: "snap-drop"
  })

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: verifiedToken.fileKey,
  });

  const url = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });
  logger.log(`Generated download presigned URL for fileKey: ${verifiedToken.fileKey}`, "INFO");
  return { url };
}catch(err){
  logger.log("Failed creating download presigned URL", "ERROR")
}
}