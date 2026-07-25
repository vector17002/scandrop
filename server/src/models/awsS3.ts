import { S3Client } from "@aws-sdk/client-s3";

class AwsS3{
  private static instance : AwsS3;

  private constructor(){
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || "ap-south-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    return s3Client;
  }

  public static getInstance(): AwsS3 {
    if (!AwsS3.instance) {
      AwsS3.instance = new AwsS3();
    }
    return AwsS3.instance;
  }
}

export default AwsS3;