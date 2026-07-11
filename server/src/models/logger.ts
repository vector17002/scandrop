type LoggerType = "ERROR" | "INFO" | "DEBUG";

class Logger {
  public static instance : Logger | null;

  private constructor() {

  }

  public static getInstance(msg: string , type : LoggerType, timestamp: Date): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public static resetInstance(): void {
    Logger.instance = null;
  }

  public log(msg: string, type: LoggerType, timestamp: Date): void {
    console.log(`[${timestamp.toISOString()}] : [${type}] : ${msg}`);

    // ANSH - IMPLEMENT FUNCTIONALITY TO LOG THE LOGS IN S3.
  }

}