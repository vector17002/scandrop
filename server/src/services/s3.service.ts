
import fs from "fs"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "../config/s3.js";
import logger from "../utils/logger.js";
import { getPresignedUrl } from "../utils/getPresignedUrl.js";

const BUCKET = process.env.AWS_S3_BUCKET_NAME

export const updateLogsFile = async (fileKey : string, localFilePath : string) => {
      try{
    // ANSH - IMPLEMENT FUNCTIONALITY TO LOG THE LOGS IN S3.
    const fileContents = fs.readFileSync(localFilePath, "utf-8");

    //@ts-ignore
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

export const upload = async (contentType : string) =>  {
  try{
     const {url , fileID} = await getPresignedUrl(contentType);

     return {url , fileID}
  }catch(err){
    logger.log(`Upload failed for fileId`, "ERROR")
  }
}

export const multiPartUpload = async () => {
  
}