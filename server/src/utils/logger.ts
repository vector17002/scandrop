import Logger from "../models/logger.js";

const logger = Logger.getInstance("Initializing S3 Client", "INFO", new Date());

export default logger;