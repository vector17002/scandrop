
import fs from "fs"
import { PutObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "../config/s3.js";

export const updateLogsFile = async (fileKey : string, localFilePath : string) => {
      try{
    // ANSH - IMPLEMENT FUNCTIONALITY TO LOG THE LOGS IN S3.
    const fileContents = fs.readFileSync(localFilePath, "utf-8");

    //@ts-ignore
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileKey,
        Body:  fileContents,
        ContentType: "text/plain",
      })
    )
  }catch(err){
    console.error("Error while logging to S3: ", err);
  }
}