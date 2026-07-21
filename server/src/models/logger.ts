import { updateLogsFile } from "../services/s3.service.js";
import { updateLocalFileLogs } from "../utils/localFileLogsUpdate.js";

type LoggerType = "ERROR" | "INFO" | "DEBUG";

class Logger {
  private static instance : Logger | null;

  private constructor() {}

  public static getInstance(msg: string , type : LoggerType): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public static resetInstance(): void {
    Logger.instance = null;
  }

  public async log(msg: string, type: LoggerType): Promise<void> {
    const timestamp = new Date()
    const logMessage = `[${timestamp.toDateString()}] : [${type}] : ${msg}`;
    console.log(logMessage);
    
    try{
    updateLocalFileLogs(logMessage);
    updateLogsFile("logs/logs.txt", "data/logs.txt");
  }catch(err){
    console.error("Error while logging to S3: ", err);
  }
  }}


export default Logger;