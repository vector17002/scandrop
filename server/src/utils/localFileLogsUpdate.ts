import fs from "fs";
import path from "path";
import fileUrlToPath from "url";
const { fileURLToPath } = fileUrlToPath;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const updateLocalFileLogs = (logs : string) => {
    try{
        const logDir = path.join(__dirname, "../../data/logs.txt");

        if (!fs.existsSync(logDir)) {
            fs.writeFileSync(logDir, JSON.stringify([
              logs
            ]));
        }else{
            fs.appendFileSync(logDir, `\n${logs}`);
        }
    }catch(err){
        console.log("Error while updating local file logs: ", err);
    }
}